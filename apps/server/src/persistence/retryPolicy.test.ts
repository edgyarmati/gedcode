import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import {
  LockTimeoutError,
  SqlError,
  UniqueViolation,
  UnknownError,
} from "effect/unstable/sql/SqlError";

import { PersistenceSqlError } from "./Errors.ts";
import {
  DEFAULT_PERSISTENCE_RETRY_POLICY,
  isRetryableSqlError,
  type PersistenceRetryPolicy,
  PersistenceRetryPolicyService,
  retryOnBusy,
  withBusyRetry,
} from "./retryPolicy.ts";

const busyError = () =>
  new SqlError({ reason: new LockTimeoutError({ cause: new Error("SQLITE_BUSY") }) });
const uniqueError = () =>
  new SqlError({ reason: new UniqueViolation({ constraint: "uq_x", cause: new Error("dup") }) });

// The real `node:sqlite` driver reports the SQLite primary result code on the
// raw cause's `errcode` field, which Effect's `classifySqliteError` does not
// read — so an *actual* SQLITE_BUSY / SQLITE_LOCKED arrives as an `UnknownError`
// reason, not a `LockTimeoutError`. These fixtures reproduce that exact shape so
// the predicate is covered against the driver it ships on (the synthetic
// `LockTimeoutError` above cannot — it is hand-classified). See
// retryPolicyContention.test.ts for the end-to-end proof against a live DB.
const rawNodeSqliteError = (errcode: number) =>
  new SqlError({
    reason: new UnknownError({
      cause: { code: "ERR_SQLITE_ERROR", errcode, errstr: "database is locked" },
    }),
  });

// Fast policy so the real-clock backoff stays sub-millisecond in tests; the
// jitter only affects delay, never the bounded execution count we assert.
const FAST_POLICY: PersistenceRetryPolicy = {
  busyTimeoutMs: 5000,
  initialBackoffMs: 1,
  maxBackoffMs: 2,
  maxAttempts: 4,
};

it.effect("isRetryableSqlError is true only for busy/locked SqlError reasons", () =>
  Effect.sync(() => {
    assert.strictEqual(isRetryableSqlError(busyError()), true);
    assert.strictEqual(isRetryableSqlError(uniqueError()), false);
    assert.strictEqual(isRetryableSqlError(new Error("plain")), false);
    // A SqlError already mapped to the persistence error type is past the retry
    // boundary and must never be retried.
    assert.strictEqual(
      isRetryableSqlError(new PersistenceSqlError({ operation: "op", detail: "d" })),
      false,
    );
  }),
);

it.effect(
  "isRetryableSqlError recognises a real node:sqlite busy/locked (errcode) misclassified as UnknownError",
  () =>
    Effect.sync(() => {
      // SQLITE_BUSY (5) and SQLITE_LOCKED (6) on the raw cause's `errcode` are
      // retryable even though the reason tag is UnknownError, not LockTimeoutError.
      assert.strictEqual(isRetryableSqlError(rawNodeSqliteError(5)), true);
      assert.strictEqual(isRetryableSqlError(rawNodeSqliteError(6)), true);
      // Any other errcode (e.g. 19 = SQLITE_CONSTRAINT) stays non-retryable —
      // the predicate must not widen to all UnknownErrors.
      assert.strictEqual(isRetryableSqlError(rawNodeSqliteError(19)), false);
      // An UnknownError with no errcode at all is not retryable.
      assert.strictEqual(
        isRetryableSqlError(new SqlError({ reason: new UnknownError({ cause: new Error("x") }) })),
        false,
      );
    }),
);

// These two exercise an actual delayed retry. `it.effect` installs a TestClock
// whose virtual time does not auto-advance, so a real-time backoff would hang
// forever; `it.live` runs against the real clock. FAST_POLICY keeps the backoff
// sub-millisecond, so wall-clock cost is negligible.
it.live("retryOnBusy retries a busy failure and then succeeds", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const effect = Effect.gen(function* () {
      const n = yield* Ref.updateAndGet(attempts, (c) => c + 1);
      if (n < 3) {
        return yield* busyError();
      }
      return "ok" as const;
    });

    const result = yield* retryOnBusy(FAST_POLICY)(effect);
    assert.strictEqual(result, "ok");
    assert.strictEqual(yield* Ref.get(attempts), 3);
  }),
);

it.live("retryOnBusy gives up after maxAttempts total executions on persistent busy", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const effect = Effect.flatMap(
      Ref.update(attempts, (c) => c + 1),
      () => Effect.fail(busyError()),
    );

    const exit = yield* Effect.exit(retryOnBusy(FAST_POLICY)(effect));
    assert.ok(Exit.isFailure(exit));
    assert.strictEqual(yield* Ref.get(attempts), FAST_POLICY.maxAttempts);
  }),
);

it.effect("retryOnBusy never retries a non-busy failure", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const effect = Effect.flatMap(
      Ref.update(attempts, (c) => c + 1),
      () => Effect.fail(uniqueError()),
    );

    const exit = yield* Effect.exit(retryOnBusy(FAST_POLICY)(effect));
    assert.ok(Exit.isFailure(exit));
    assert.strictEqual(yield* Ref.get(attempts), 1);
  }),
);

it.effect("DEFAULT_PERSISTENCE_RETRY_POLICY exposes safe-by-default values", () =>
  Effect.sync(() => {
    assert.strictEqual(DEFAULT_PERSISTENCE_RETRY_POLICY.busyTimeoutMs, 5000);
    assert.ok(DEFAULT_PERSISTENCE_RETRY_POLICY.maxAttempts >= 1);
    assert.ok(
      DEFAULT_PERSISTENCE_RETRY_POLICY.maxBackoffMs >=
        DEFAULT_PERSISTENCE_RETRY_POLICY.initialBackoffMs,
    );
  }),
);

it.live("withBusyRetry honours the policy provided via PersistenceRetryPolicyService", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const effect = Effect.flatMap(
      Ref.update(attempts, (c) => c + 1),
      () => Effect.fail(busyError()),
    );

    const exit = yield* Effect.exit(
      withBusyRetry(effect).pipe(Effect.provideService(PersistenceRetryPolicyService, FAST_POLICY)),
    );
    assert.ok(Exit.isFailure(exit));
    assert.strictEqual(yield* Ref.get(attempts), FAST_POLICY.maxAttempts);
  }),
);

it.live("withBusyRetry falls back to the default policy when the service is absent", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const effect = Effect.flatMap(
      Ref.update(attempts, (c) => c + 1),
      () => Effect.fail(busyError()),
    );

    // No PersistenceRetryPolicyService in context → DEFAULT policy applies.
    const exit = yield* Effect.exit(withBusyRetry(effect));
    assert.ok(Exit.isFailure(exit));
    assert.strictEqual(yield* Ref.get(attempts), DEFAULT_PERSISTENCE_RETRY_POLICY.maxAttempts);
  }),
);

it.live("withBusyRetry never retries a non-busy failure regardless of policy", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const effect = Effect.flatMap(
      Ref.update(attempts, (c) => c + 1),
      () => Effect.fail(uniqueError()),
    );

    const exit = yield* Effect.exit(
      withBusyRetry(effect).pipe(Effect.provideService(PersistenceRetryPolicyService, FAST_POLICY)),
    );
    assert.ok(Exit.isFailure(exit));
    assert.strictEqual(yield* Ref.get(attempts), 1);
  }),
);
