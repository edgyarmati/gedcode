import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const EXPECTED_COLUMNS = [
  "task_id",
  "project_id",
  "type",
  "title",
  "status",
  "branch",
  "worktree_path",
  "pm_message_id",
  "stage_thread_ids_json",
  "current_stage_thread_id",
  "playbook_version",
  "created_at",
  "updated_at",
] as const;

layer("033_ProjectionTasks", (it) => {
  it.effect("creates projection_tasks mirroring OrchestrationTask on a fresh DB", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });
      yield* runMigrations({ toMigrationInclusive: 33 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_tasks)
      `;
      const columnNames = new Set(columns.map((column) => column.name));
      for (const expected of EXPECTED_COLUMNS) {
        assert.ok(columnNames.has(expected), `missing column ${expected}`);
      }

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_tasks)
      `;
      assert.ok(indexes.some((index) => index.name === "idx_projection_tasks_project_status"));
      assert.ok(indexes.some((index) => index.name === "idx_projection_tasks_project_updated"));
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 33 });

      // Re-running must not throw and must not re-execute migration 33.
      const replay = yield* runMigrations({ toMigrationInclusive: 33 });
      assert.ok(replay.every(([id]) => id !== 33));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 33
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
