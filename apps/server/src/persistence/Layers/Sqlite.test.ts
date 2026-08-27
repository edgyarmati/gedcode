import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CURRENT_SCHEMA_MIGRATION_ID } from "../Migrations.ts";
import { DEFAULT_PERSISTENCE_RETRY_POLICY, PersistenceRetryPolicyService } from "../retryPolicy.ts";
import {
  makeSqlitePersistenceMemory,
  prepareMigrationBackup,
  SqlitePersistenceMemory,
} from "./Sqlite.ts";

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

it.effect("creates and retains a recoverable pre-migration database backup", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-migration-backup-" });
    const dbPath = path.join(directory, "state.sqlite");
    yield* fs.writeFileString(dbPath, "legacy-database");
    yield* fs.writeFileString(`${dbPath}-wal`, "legacy-wal");
    yield* fs.writeFileString(`${dbPath}.schema-version`, `${CURRENT_SCHEMA_MIGRATION_ID - 1}\n`);

    const prepared = yield* prepareMigrationBackup(dbPath);
    assert.isNotNull(prepared.backupPath);
    assert.strictEqual(
      yield* fs.readFileString(path.join(prepared.backupPath!, "state.sqlite")),
      "legacy-database",
    );
    assert.strictEqual(
      yield* fs.readFileString(path.join(prepared.backupPath!, "state.sqlite-wal")),
      "legacy-wal",
    );
    assert.strictEqual(
      yield* fs.readFileString(path.join(prepared.backupPath!, "state.sqlite.schema-version")),
      `${CURRENT_SCHEMA_MIGRATION_ID - 1}\n`,
    );
    assert.include(
      yield* fs.readFileString(path.join(prepared.backupPath!, "RECOVERY.txt")),
      "Quit GedCode before restoring",
    );

    yield* fs.writeFileString(prepared.markerPath, `${CURRENT_SCHEMA_MIGRATION_ID}\n`);
    const alreadyCurrent = yield* prepareMigrationBackup(dbPath);
    assert.isNull(alreadyCurrent.backupPath);
  }).pipe(Effect.provide(NodeServices.layer)),
);
