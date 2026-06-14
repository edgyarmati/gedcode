import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const EXPECTED_AWAITED_COLUMNS = [
  "task_id",
  "stage_thread_id",
  "role",
  "awaited_turn_id",
  "status",
  "started_at",
  "completed_at",
] as const;

const EXPECTED_GATE_COLUMNS = [
  "gate_id",
  "task_id",
  "gate",
  "content_hash",
  "stage_thread_id",
  "status",
  "approved_hash",
  "decision",
  "origin",
  "requested_at",
  "resolved_at",
] as const;

layer("034_ProjectionAwaitedStagesAndPendingGates", (it) => {
  it.effect("creates both reconciliation-source tables on a fresh DB", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* runMigrations({ toMigrationInclusive: 34 });

      const awaitedColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_awaited_stages)
      `;
      const awaitedNames = new Set(awaitedColumns.map((column) => column.name));
      for (const expected of EXPECTED_AWAITED_COLUMNS) {
        assert.ok(awaitedNames.has(expected), `awaited missing column ${expected}`);
      }

      const gateColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_pending_gates)
      `;
      const gateNames = new Set(gateColumns.map((column) => column.name));
      for (const expected of EXPECTED_GATE_COLUMNS) {
        assert.ok(gateNames.has(expected), `gate missing column ${expected}`);
      }

      const awaitedIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_awaited_stages)
      `;
      assert.ok(
        awaitedIndexes.some((index) => index.name === "idx_projection_awaited_stages_task_status"),
      );
      assert.ok(
        awaitedIndexes.some((index) => index.name === "idx_projection_awaited_stages_status"),
      );

      const gateIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_pending_gates)
      `;
      assert.ok(
        gateIndexes.some((index) => index.name === "idx_projection_pending_gates_task_status"),
      );
      assert.ok(gateIndexes.some((index) => index.name === "idx_projection_pending_gates_status"));
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 34 });

      const replay = yield* runMigrations({ toMigrationInclusive: 34 });
      assert.ok(replay.every(([id]) => id !== 34));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 34
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
