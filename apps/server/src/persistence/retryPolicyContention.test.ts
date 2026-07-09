/**
 * Real-driver contention coverage for the busy/locked retry (Plan 019 WP-1).
 *
 * The unit tests in `retryPolicy.test.ts` exercise the retry algorithm against a
 * *synthetic* `LockTimeoutError`. That leaves one gap a synthetic error can never
 * close: does an actual `node:sqlite` `SQLITE_BUSY` flow through
 * `classifySqliteError` to a `LockTimeoutError` reason, so {@link isRetryableSqlError}
 * fires? If the real driver classified busy differently, the entire feature would
 * be silently dead in production while every synthetic test stayed green.
 *
 * A single `SqlClient` cannot produce this contention — `NodeSqliteClient`
 * serializes every operation through a `Semaphore.make(1)`. So we open *two*
 * `NodeSqliteClient` connections to the *same* file DB and make them contend for
 * the SQLite write lock.
 *
 * **Determinism (no timing reliance for the core assertion).** The holder fiber
 * opens a write transaction, performs an INSERT (which takes the WAL write lock),
 * signals `lockHeld`, then parks on `release`. The transaction stays open — and
 * the lock held — for as long as the holder parks, because no COMMIT is issued
 * until `release` fires. The contender uses `PRAGMA busy_timeout = 0`, so it fails
 * *immediately* with `SQLITE_BUSY` rather than blocking. We control exactly when
 * the holder releases, so there is no wall-clock race in the classification test.
 *
 * These run under the same Node runtime the server ships on (`bun run test` →
 * turbo → vitest, whose `#!/usr/bin/env node` shebang selects the node loader),
 * so the client under test is the client that ships.
 *
 * @module persistence/retryPolicyContention
 */
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as nodeSqliteClientLayer } from "./NodeSqliteClient.ts";
import { type PersistenceRetryPolicy, retryOnBusy } from "./retryPolicy.ts";

// Create the schema (WAL + probe table) on a throwaway connection that closes
// before the contending connections open, so neither holder nor contender hits
// lock contention during its own setup — only at the INSERT we control.
const bootstrapSchema = (filename: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`CREATE TABLE IF NOT EXISTS retry_probe (v INTEGER NOT NULL);`;
  }).pipe(Effect.provide(nodeSqliteClientLayer({ filename })));

// A dedicated connection that opens a write transaction, grabs the write lock via
// an INSERT, signals `lockHeld`, and holds the lock open until `release` fires.
const makeLockHolder = (
  filename: string,
  lockHeld: Deferred.Deferred<void>,
  release: Deferred.Deferred<void>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA busy_timeout = 0;`;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT INTO retry_probe (v) VALUES (1)`;
        yield* Deferred.succeed(lockHeld, undefined);
        yield* Deferred.await(release);
      }),
    );
  }).pipe(Effect.provide(nodeSqliteClientLayer({ filename })));

// Allocate a throwaway temp DB via the Effect `FileSystem`/`Path` services
// (provided by `NodeServices.layer`), then remove it once `run` settles. Using
// the Effect APIs rather than `node:fs`/`node:path` keeps the file inside the
// enabled `nodeBuiltinImport` diagnostic; cleanup is best-effort (`ignore`) so a
// stray removal failure never masks the assertion under test.
const withTempDb = <A, E, R>(run: (filename: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempDir = yield* fs.makeTempDirectory({ prefix: "gedcode-busy-contention-" });
    const filename = path.join(tempDir, "contention.sqlite");
    return yield* run(filename).pipe(
      Effect.ensuring(fs.remove(tempDir, { recursive: true }).pipe(Effect.ignore)),
    );
  });

// Bounded, fast policy: the holder never releases until the contender has
// exhausted, so every attempt is a real SQLITE_BUSY. Sub-millisecond backoff
// keeps the wall-clock cost negligible.
const EXHAUST_POLICY: PersistenceRetryPolicy = {
  busyTimeoutMs: 0,
  initialBackoffMs: 1,
  maxBackoffMs: 2,
  maxAttempts: 3,
};

// These use `it.live` (the real clock) because the retry backoff sleeps for real
// time and the holder/contender fibers coordinate concurrently — a TestClock
// (`it.effect`) would never advance the backoff. `NodeServices.layer` is provided
// per test (rather than via `it.layer`, whose scoped `it` exposes no `.live`),
// supplying the `FileSystem`/`Path` services `withTempDb` needs; the contention
// itself still rides real `NodeSqliteClient` connections.
it.live(
  "retryOnBusy retries a REAL node:sqlite SQLITE_BUSY to the bound (proves busy classifies as retryable)",
  () =>
    withTempDb((filename) =>
      Effect.gen(function* () {
        yield* bootstrapSchema(filename);

        const lockHeld = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const attempts = yield* Ref.make(0);

        const holderFiber = yield* Effect.forkChild(makeLockHolder(filename, lockHeld, release));
        // Only contend once the holder actually owns the write lock.
        yield* Deferred.await(lockHeld);

        const contender = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`PRAGMA busy_timeout = 0;`;
          yield* retryOnBusy(EXHAUST_POLICY)(
            Effect.gen(function* () {
              yield* Ref.update(attempts, (n) => n + 1);
              yield* sql.withTransaction(sql`INSERT INTO retry_probe (v) VALUES (2)`);
            }),
          );
        }).pipe(Effect.provide(nodeSqliteClientLayer({ filename })));

        // The holder still holds the lock, so every attempt hits a real busy and
        // the retry exhausts. A misclassified busy would short-circuit after one
        // attempt — so `attempts === maxAttempts` is the proof the real error is
        // retryable.
        const exit = yield* Effect.exit(contender);
        assert.ok(Exit.isFailure(exit));
        assert.strictEqual(yield* Ref.get(attempts), EXHAUST_POLICY.maxAttempts);

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(holderFiber);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("retryOnBusy recovers a REAL contended write once the lock is released (end-to-end)", () =>
  withTempDb((filename) =>
    Effect.gen(function* () {
      yield* bootstrapSchema(filename);

      const lockHeld = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const firstFailure = yield* Deferred.make<void>();
      const attempts = yield* Ref.make(0);

      // Generous attempts; backoff (25ms) dwarfs the holder's commit latency
      // (microseconds), so the post-release retry deterministically lands after
      // the lock is free.
      const recoverPolicy: PersistenceRetryPolicy = {
        busyTimeoutMs: 0,
        initialBackoffMs: 25,
        maxBackoffMs: 50,
        maxAttempts: 50,
      };

      const holderFiber = yield* Effect.forkChild(makeLockHolder(filename, lockHeld, release));
      yield* Deferred.await(lockHeld);

      const contender = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`PRAGMA busy_timeout = 0;`;
        yield* retryOnBusy(recoverPolicy)(
          Effect.gen(function* () {
            yield* Ref.update(attempts, (n) => n + 1);
            yield* sql.withTransaction(sql`INSERT INTO retry_probe (v) VALUES (2)`);
          }).pipe(Effect.tapError(() => Deferred.succeed(firstFailure, undefined))),
        );
      }).pipe(Effect.provide(nodeSqliteClientLayer({ filename })));

      const contenderFiber = yield* Effect.forkChild(contender);
      // The first attempt fails on the held lock; only then release it so the
      // next retry can succeed — this guarantees at least one real-busy retry.
      yield* Deferred.await(firstFailure);
      yield* Deferred.succeed(release, undefined);

      yield* Fiber.join(contenderFiber);
      const finalAttempts = yield* Ref.get(attempts);
      assert.ok(finalAttempts >= 2, `expected >= 2 attempts, got ${finalAttempts}`);

      // The retried write committed: the contender row is present.
      const rows = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ readonly v: number }>`SELECT v FROM retry_probe WHERE v = 2`;
      }).pipe(Effect.provide(nodeSqliteClientLayer({ filename })));
      assert.strictEqual(rows.length, 1);

      yield* Fiber.join(holderFiber);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
