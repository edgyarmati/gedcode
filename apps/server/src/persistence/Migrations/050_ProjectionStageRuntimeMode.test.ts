import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("050_ProjectionStageRuntimeMode", (it) => {
  it.effect("adds runtime mode and backfills it from the actual stage thread", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          created_at, updated_at
        ) VALUES (
          'stage-runtime', 'project-runtime', 'Runtime stage',
          '{"instanceId":"codex","model":"gpt-5"}', 'approval-required', 'default',
          '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_stage_history (
          stage_thread_id, project_id, task_id, role, provider_instance_id, model, status,
          started_at, ended_at
        ) VALUES (
          'stage-runtime', 'project-runtime', 'task-runtime', 'work', 'codex', 'gpt-5', 'completed',
          '2026-07-14T00:00:00.000Z', '2026-07-14T00:01:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 50 });
      const rows = yield* sql<{ readonly runtimeMode: string | null }>`
        SELECT runtime_mode AS "runtimeMode"
        FROM projection_stage_history
        WHERE stage_thread_id = 'stage-runtime'
      `;
      assert.strictEqual(rows[0]?.runtimeMode, "approval-required");
    }),
  );
});
