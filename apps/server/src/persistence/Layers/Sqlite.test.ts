import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
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

it.effect("creates a recoverable migration backup without legacy pairing credentials", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-migration-backup-" });
    const dbPath = path.join(directory, "state.sqlite");
    const plaintextCredential = "PAIRING-SECRET-MUST-NOT-SURVIVE";
    yield* Effect.sync(() => {
      const database = new DatabaseSync(dbPath);
      try {
        database.exec(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE auth_pairing_links (
            id TEXT PRIMARY KEY,
            credential TEXT NOT NULL UNIQUE,
            method TEXT NOT NULL,
            role TEXT NOT NULL,
            subject TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            revoked_at TEXT
          );
          CREATE TABLE recovery_probe (value TEXT NOT NULL);
        `);
        database
          .prepare(
            `INSERT INTO auth_pairing_links (
              id, credential, method, role, subject, label, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "pairing-1",
            plaintextCredential,
            "one-time-token",
            "client",
            "one-time-token",
            "Phone",
            "2026-08-30T12:00:00.000Z",
            "2026-08-30T12:05:00.000Z",
          );
        database.prepare("INSERT INTO recovery_probe (value) VALUES (?)").run("keep-me");
      } finally {
        database.close();
      }
    });
    yield* fs.writeFileString(`${dbPath}.schema-version`, `${CURRENT_SCHEMA_MIGRATION_ID - 1}\n`);

    const prepared = yield* prepareMigrationBackup(dbPath);
    assert.isNotNull(prepared.backupPath);
    const backupDatabasePath = path.join(prepared.backupPath!, "state.sqlite");
    const recovered = yield* Effect.sync(() => {
      const database = new DatabaseSync(backupDatabasePath, { readOnly: true });
      try {
        return {
          pairingLinks: database.prepare("SELECT id FROM auth_pairing_links").all(),
          probe: database.prepare("SELECT value FROM recovery_probe").all(),
        };
      } finally {
        database.close();
      }
    });
    assert.deepStrictEqual(recovered.pairingLinks, []);
    assert.deepStrictEqual(recovered.probe, [{ value: "keep-me" }]);

    const backupEntries = yield* fs.readDirectory(prepared.backupPath!);
    for (const entry of backupEntries) {
      const bytes = yield* fs.readFile(path.join(prepared.backupPath!, entry));
      assert.isFalse(Buffer.from(bytes).includes(Buffer.from(plaintextCredential)));
    }
    assert.strictEqual(
      yield* fs.readFileString(path.join(prepared.backupPath!, "state.sqlite.schema-version")),
      `${CURRENT_SCHEMA_MIGRATION_ID - 1}\n`,
    );
    assert.include(
      yield* fs.readFileString(path.join(prepared.backupPath!, "RECOVERY.txt")),
      "Quit GedCode before restoring",
    );
    assert.include(
      yield* fs.readFileString(path.join(prepared.backupPath!, "RECOVERY.txt")),
      "Pairing links were removed",
    );

    yield* fs.writeFileString(prepared.markerPath, `${CURRENT_SCHEMA_MIGRATION_ID}\n`);
    const alreadyCurrent = yield* prepareMigrationBackup(dbPath);
    assert.isNull(alreadyCurrent.backupPath);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("sanitizes a pre-existing legacy pairing backup before returning", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({
      prefix: "gedcode-existing-migration-backup-",
    });
    const dbPath = path.join(directory, "state.sqlite");
    const backupPath = path.join(
      directory,
      "migration-backups",
      `state.sqlite.before-schema-${CURRENT_SCHEMA_MIGRATION_ID}`,
    );
    const backupDbPath = path.join(backupPath, "state.sqlite");
    const plaintextCredential = "PAIRING-SECRET-IN-EXISTING-BACKUP";
    yield* fs.makeDirectory(backupPath, { recursive: true });

    yield* Effect.sync(() => {
      const liveDatabase = new DatabaseSync(dbPath);
      liveDatabase.close();

      const backupDatabase = new DatabaseSync(backupDbPath);
      try {
        backupDatabase.exec(`
          CREATE TABLE auth_pairing_links (
            id TEXT PRIMARY KEY,
            credential TEXT NOT NULL UNIQUE,
            method TEXT NOT NULL,
            role TEXT NOT NULL,
            subject TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            revoked_at TEXT
          );
          CREATE TABLE recovery_probe (value TEXT NOT NULL);
        `);
        backupDatabase
          .prepare(
            `INSERT INTO auth_pairing_links (
              id, credential, method, role, subject, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "pairing-existing",
            plaintextCredential,
            "one-time-token",
            "client",
            "one-time-token",
            "2026-08-30T12:00:00.000Z",
            "2026-08-30T12:05:00.000Z",
          );
        backupDatabase.prepare("INSERT INTO recovery_probe (value) VALUES (?)").run("keep-me");
      } finally {
        backupDatabase.close();
      }
    });
    yield* fs.writeFileString(`${dbPath}.schema-version`, `${CURRENT_SCHEMA_MIGRATION_ID}\n`);
    yield* fs.writeFileString(path.join(backupPath, "RECOVERY.txt"), "Existing recovery note.\n");

    const prepared = yield* prepareMigrationBackup(dbPath);
    assert.isNull(prepared.backupPath);

    const recovered = yield* Effect.sync(() => {
      const database = new DatabaseSync(backupDbPath, { readOnly: true });
      try {
        return {
          pairingLinks: database.prepare("SELECT id FROM auth_pairing_links").all(),
          probe: database.prepare("SELECT value FROM recovery_probe").all(),
        };
      } finally {
        database.close();
      }
    });
    assert.deepStrictEqual(recovered.pairingLinks, []);
    assert.deepStrictEqual(recovered.probe, [{ value: "keep-me" }]);
    assert.include(
      yield* fs.readFileString(path.join(backupPath, "RECOVERY.txt")),
      "Pairing links were removed",
    );
    for (const entry of yield* fs.readDirectory(backupPath)) {
      const bytes = yield* fs.readFile(path.join(backupPath, entry));
      assert.isFalse(Buffer.from(bytes).includes(Buffer.from(plaintextCredential)));
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("sanitizes legacy backups even when the live database is missing", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({
      prefix: "gedcode-orphaned-migration-backup-",
    });
    const dbPath = path.join(directory, "state.sqlite");
    const backupPath = path.join(
      directory,
      "migration-backups",
      `state.sqlite.before-schema-${CURRENT_SCHEMA_MIGRATION_ID}`,
    );
    const backupDbPath = path.join(backupPath, "state.sqlite");
    yield* fs.makeDirectory(backupPath, { recursive: true });
    yield* Effect.sync(() => {
      const database = new DatabaseSync(backupDbPath);
      try {
        database.exec(`
          CREATE TABLE auth_pairing_links (
            id TEXT PRIMARY KEY,
            credential TEXT NOT NULL UNIQUE,
            method TEXT NOT NULL,
            role TEXT NOT NULL,
            subject TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            revoked_at TEXT
          );
          INSERT INTO auth_pairing_links (
            id, credential, method, role, subject, created_at, expires_at
          ) VALUES (
            'pairing-orphaned', 'ORPHANED-PAIRING-SECRET', 'one-time-token', 'client',
            'one-time-token', '2026-08-30T12:00:00.000Z', '2026-08-30T12:05:00.000Z'
          );
        `);
      } finally {
        database.close();
      }
    });

    const prepared = yield* prepareMigrationBackup(dbPath);
    assert.isNull(prepared.backupPath);
    const remaining = yield* Effect.sync(() => {
      const database = new DatabaseSync(backupDbPath, { readOnly: true });
      try {
        return database.prepare("SELECT id FROM auth_pairing_links").all();
      } finally {
        database.close();
      }
    });
    assert.deepStrictEqual(remaining, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);
