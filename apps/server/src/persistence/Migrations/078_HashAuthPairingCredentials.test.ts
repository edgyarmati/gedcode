import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { digestPairingCredential } from "../../auth/pairingCredentialDigest.ts";
import { makeSqlitePersistenceLive } from "../Layers/Sqlite.ts";
import { CURRENT_SCHEMA_MIGRATION_ID, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.effect("upgrades plaintext pairing credentials without retaining their bytes", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-pairing-digest-" });
    const dbPath = path.join(directory, "state.sqlite");
    const plaintextCredential = "PAIRING-SECRET-UPGRADE-BYTES";

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA journal_mode = WAL`;
      yield* runMigrations({ toMigrationInclusive: 77 });
      yield* sql`
        INSERT INTO auth_pairing_links (
          id,
          credential,
          method,
          role,
          subject,
          label,
          created_at,
          expires_at,
          consumed_at,
          revoked_at
        ) VALUES (
          'pairing-before-078',
          ${plaintextCredential},
          'one-time-token',
          'client',
          'one-time-token',
          'Upgrade phone',
          '2026-08-30T12:00:00.000Z',
          '2026-08-30T12:05:00.000Z',
          NULL,
          NULL
        )
      `;
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })), Effect.scoped);
    yield* fs.writeFileString(`${dbPath}.schema-version`, "77\n");

    const liveLayer = makeSqlitePersistenceLive(dbPath);
    const upgradedRows = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_pairing_links)
      `;
      const rows = yield* sql<{
        readonly credentialDigest: string;
        readonly label: string | null;
      }>`
        SELECT credential_digest AS "credentialDigest", label
        FROM auth_pairing_links
        WHERE id = 'pairing-before-078'
      `;
      return { columns, rows };
    }).pipe(Effect.provide(liveLayer), Effect.scoped);

    assert.notInclude(
      upgradedRows.columns.map((column) => column.name),
      "credential",
    );
    assert.deepStrictEqual(upgradedRows.rows, [
      {
        credentialDigest: digestPairingCredential(plaintextCredential),
        label: "Upgrade phone",
      },
    ]);

    const pathsToInspect: Array<string> = [];
    for (const entry of yield* fs.readDirectory(directory)) {
      const entryPath = path.join(directory, entry);
      if (entry.startsWith("state.sqlite") && (yield* fs.exists(entryPath))) {
        pathsToInspect.push(entryPath);
      }
    }
    const backupPath = path.join(
      directory,
      "migration-backups",
      `state.sqlite.before-schema-${CURRENT_SCHEMA_MIGRATION_ID}`,
    );
    for (const entry of yield* fs.readDirectory(backupPath)) {
      pathsToInspect.push(path.join(backupPath, entry));
    }
    for (const filePath of pathsToInspect) {
      const bytes = yield* fs.readFile(filePath);
      assert.isFalse(
        Buffer.from(bytes).includes(Buffer.from(plaintextCredential)),
        `plaintext credential remained in ${filePath}`,
      );
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "finishes plaintext scrubbing after migration 078 committed before the schema marker",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: "gedcode-pairing-digest-resume-",
      });
      const dbPath = path.join(directory, "state.sqlite");
      const plaintextCredential = "PAIRING-SECRET-CRASHED-AFTER-078";

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`PRAGMA journal_mode = WAL`;
        yield* runMigrations({ toMigrationInclusive: 77 });
        yield* sql`
        INSERT INTO auth_pairing_links (
          id,
          credential,
          method,
          role,
          subject,
          label,
          created_at,
          expires_at,
          consumed_at,
          revoked_at
        ) VALUES (
          'pairing-crash-before-finalize',
          ${plaintextCredential},
          'one-time-token',
          'client',
          'one-time-token',
          'Crash recovery phone',
          '2026-08-30T12:00:00.000Z',
          '2026-08-30T12:05:00.000Z',
          NULL,
          NULL
        )
      `;
        // Simulate a process dying after the migration transaction committed but
        // before the post-migration scrub and schema-marker rename completed.
        yield* runMigrations({ toMigrationInclusive: 78 });
        yield* fs.writeFileString(`${dbPath}.schema-version`, "77\n");

        const liveLayer = makeSqlitePersistenceLive(dbPath);
        yield* Effect.gen(function* () {
          const liveSql = yield* SqlClient.SqlClient;
          const rows = yield* liveSql<{ readonly credentialDigest: string }>`
          SELECT credential_digest AS "credentialDigest"
          FROM auth_pairing_links
          WHERE id = 'pairing-crash-before-finalize'
        `;
          assert.deepStrictEqual(rows, [
            { credentialDigest: digestPairingCredential(plaintextCredential) },
          ]);
        }).pipe(Effect.provide(liveLayer), Effect.scoped);

        const pathsToInspect: Array<string> = [];
        for (const entry of yield* fs.readDirectory(directory)) {
          if (entry.startsWith("state.sqlite")) {
            pathsToInspect.push(path.join(directory, entry));
          }
        }
        const backupPath = path.join(
          directory,
          "migration-backups",
          `state.sqlite.before-schema-${CURRENT_SCHEMA_MIGRATION_ID}`,
        );
        for (const entry of yield* fs.readDirectory(backupPath)) {
          pathsToInspect.push(path.join(backupPath, entry));
        }
        for (const filePath of pathsToInspect) {
          const bytes = yield* fs.readFile(filePath);
          assert.isFalse(
            Buffer.from(bytes).includes(Buffer.from(plaintextCredential)),
            `plaintext credential remained after crash recovery in ${filePath}`,
          );
        }
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })), Effect.scoped);
    }).pipe(Effect.provide(NodeServices.layer)),
);
