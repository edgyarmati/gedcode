import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const EXPECTED_CURSOR_COLUMNS = ["project_id", "last_consumed_sequence", "updated_at"] as const;

const EXPECTED_SETTLEMENT_COLUMNS = [
  "project_id",
  "kind",
  "settlement_key",
  "consumed_at",
] as const;

layer("036_PmRuntimeCursorAndConsumedSettlements", (it) => {
  it.effect("creates the exactly-once re-entry tables on a fresh DB", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* runMigrations({ toMigrationInclusive: 36 });

      const cursorColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(pm_runtime_cursor)
      `;
      const cursorNames = new Set(cursorColumns.map((column) => column.name));
      for (const expected of EXPECTED_CURSOR_COLUMNS) {
        assert.ok(cursorNames.has(expected), `cursor missing column ${expected}`);
      }

      const settlementColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(pm_consumed_settlements)
      `;
      const settlementNames = new Set(settlementColumns.map((column) => column.name));
      for (const expected of EXPECTED_SETTLEMENT_COLUMNS) {
        assert.ok(settlementNames.has(expected), `settlement missing column ${expected}`);
      }

      const settlementIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(pm_consumed_settlements)
      `;
      assert.ok(
        settlementIndexes.some(
          (index) => index.name === "idx_pm_consumed_settlements_project_kind",
        ),
      );
    }),
  );

  it.effect("enforces the consumed-marker primary key (exactly-once)", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });

      yield* sql`
        INSERT INTO pm_consumed_settlements (project_id, kind, settlement_key, consumed_at)
        VALUES ('project-1', 'stage', 'thread-1::turn-1', '2026-06-14T00:00:00.000Z')
      `;

      // A duplicate settlement marker (same project/kind/key) must be rejected so
      // a settlement that lands during the restart window yields exactly one
      // re-entry. `INSERT OR IGNORE` is the runtime's check-and-insert primitive.
      yield* sql`
        INSERT OR IGNORE INTO pm_consumed_settlements (project_id, kind, settlement_key, consumed_at)
        VALUES ('project-1', 'stage', 'thread-1::turn-1', '2026-06-14T00:01:00.000Z')
      `;

      const rows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM pm_consumed_settlements
        WHERE project_id = 'project-1'
      `;
      assert.strictEqual(rows[0]?.count, 1);
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 36 });

      const replay = yield* runMigrations({ toMigrationInclusive: 36 });
      assert.ok(replay.every(([id]) => id !== 36));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 36
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
