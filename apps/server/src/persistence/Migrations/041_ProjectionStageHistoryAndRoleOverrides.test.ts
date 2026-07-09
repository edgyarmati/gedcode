import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_ProjectionStageHistoryAndRoleOverrides", (it) => {
  it.effect("adds role override columns and stage-history projection table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });

      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      const taskColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_tasks)
      `;
      const stageHistoryColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_stage_history)
      `;

      assert.ok(projectColumns.some((column) => column.name === "role_prompt_prefixes_json"));
      assert.ok(taskColumns.some((column) => column.name === "role_model_selections_json"));
      assert.ok(stageHistoryColumns.some((column) => column.name === "stage_thread_id"));
      assert.ok(stageHistoryColumns.some((column) => column.name === "provider_instance_id"));
      assert.ok(stageHistoryColumns.some((column) => column.name === "started_at"));
      assert.ok(stageHistoryColumns.some((column) => column.name === "ended_at"));
    }),
  );

  it.effect("is idempotent when migrations re-run on an already-migrated DB", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 41 });

      const replay = yield* runMigrations({ toMigrationInclusive: 41 });
      assert.ok(replay.every(([id]) => id !== 41));

      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 41
      `;
      assert.strictEqual(recorded[0]?.count, 1);
    }),
  );
});
