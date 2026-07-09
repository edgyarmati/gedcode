import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

// Mirrors the pi `SessionStorage` contract (decision-doc A2, CONFIRMED):
// metadata (`id`, `createdAt`) + a nullable leaf pointer.
const EXPECTED_SESSION_COLUMNS = ["session_id", "created_at", "leaf_id"] as const;

// Mirrors `SessionTreeEntryBase` (`id`, `parentId`, `timestamp`, `type`) plus
// the type-specific payload stored as JSON.
const EXPECTED_ENTRY_COLUMNS = [
  "entry_id",
  "session_id",
  "parent_id",
  "type",
  "timestamp",
  "payload_json",
] as const;

layer("035_PmSessionEntries", (it) => {
  it.effect("creates pi SessionStorage tables matching A2 on a fresh DB", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* runMigrations({ toMigrationInclusive: 35 });

      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(pm_sessions)
      `;
      const sessionNames = new Set(sessionColumns.map((column) => column.name));
      for (const expected of EXPECTED_SESSION_COLUMNS) {
        assert.ok(sessionNames.has(expected), `pm_sessions missing column ${expected}`);
      }

      const entryColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(pm_session_entries)
      `;
      const entryNames = new Set(entryColumns.map((column) => column.name));
      for (const expected of EXPECTED_ENTRY_COLUMNS) {
        assert.ok(entryNames.has(expected), `pm_session_entries missing column ${expected}`);
      }

      const entryIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(pm_session_entries)
      `;
      assert.ok(entryIndexes.some((index) => index.name === "idx_pm_session_entries_session_type"));
      assert.ok(
        entryIndexes.some((index) => index.name === "idx_pm_session_entries_session_parent"),
      );
    }),
  );

  it.effect("stores a discriminated SessionTreeEntry with a nullable parent root", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });

      yield* sql`
        INSERT INTO pm_sessions (session_id, created_at, leaf_id)
        VALUES ('session-1', '2026-06-14T00:00:00.000Z', NULL)
      `;
      yield* sql`
        INSERT INTO pm_session_entries (entry_id, session_id, parent_id, type, timestamp, payload_json)
        VALUES ('entry-root', 'session-1', NULL, 'message', '2026-06-14T00:00:01.000Z', '{"message":{}}')
      `;
      yield* sql`
        INSERT INTO pm_session_entries (entry_id, session_id, parent_id, type, timestamp, payload_json)
        VALUES ('entry-leaf', 'session-1', 'entry-root', 'leaf', '2026-06-14T00:00:02.000Z', '{"targetId":"entry-root"}')
      `;

      const rows = yield* sql<{
        readonly entry_id: string;
        readonly parent_id: string | null;
        readonly type: string;
      }>`
        SELECT entry_id, parent_id, type
        FROM pm_session_entries
        WHERE session_id = 'session-1'
        ORDER BY timestamp ASC
      `;
      assert.deepStrictEqual(
        rows.map((row) => [row.entry_id, row.parent_id, row.type]),
        [
          ["entry-root", null, "message"],
          ["entry-leaf", "entry-root", "leaf"],
        ],
      );
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 35 });

      const replay = yield* runMigrations({ toMigrationInclusive: 35 });
      assert.ok(replay.every(([id]) => id !== 35));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 35
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
