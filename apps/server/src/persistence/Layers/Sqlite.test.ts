import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { DEFAULT_PERSISTENCE_RETRY_POLICY, PersistenceRetryPolicyService } from "../retryPolicy.ts";
import { makeSqlitePersistenceMemory, SqlitePersistenceMemory } from "./Sqlite.ts";

// `PRAGMA busy_timeout;` returns a single row with a `timeout` column holding the
// currently-configured block window in milliseconds.
const readBusyTimeout = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout;`;
  return rows[0]?.timeout;
});

it.effect("setup applies the configured PRAGMA busy_timeout on a fresh DB", () =>
  readBusyTimeout.pipe(
    Effect.map((timeout) => {
      assert.strictEqual(timeout, 1234);
    }),
    Effect.provide(
      makeSqlitePersistenceMemory({ ...DEFAULT_PERSISTENCE_RETRY_POLICY, busyTimeoutMs: 1234 }),
    ),
  ),
);

it.effect("setup defaults PRAGMA busy_timeout to the safe default", () =>
  readBusyTimeout.pipe(
    Effect.map((timeout) => {
      assert.strictEqual(timeout, DEFAULT_PERSISTENCE_RETRY_POLICY.busyTimeoutMs);
    }),
    Effect.provide(SqlitePersistenceMemory),
  ),
);

it.effect("persistence layer provides the retry policy service alongside the SQL client", () =>
  Effect.gen(function* () {
    const policy = yield* PersistenceRetryPolicyService;
    assert.strictEqual(policy.busyTimeoutMs, 4321);
    assert.strictEqual(policy.maxAttempts, DEFAULT_PERSISTENCE_RETRY_POLICY.maxAttempts);
  }).pipe(
    Effect.provide(
      makeSqlitePersistenceMemory({ ...DEFAULT_PERSISTENCE_RETRY_POLICY, busyTimeoutMs: 4321 }),
    ),
  ),
);
