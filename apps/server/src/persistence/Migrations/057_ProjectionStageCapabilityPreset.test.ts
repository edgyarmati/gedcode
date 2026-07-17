import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("057_ProjectionStageCapabilityPreset", (it) => {
  it.effect("adds nullable tier and resolved model-option history columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 56 });
      yield* sql`
        INSERT INTO projection_stage_history (
          stage_thread_id, project_id, task_id, role, provider_instance_id, model, runtime_mode,
          status, started_at, ended_at
        ) VALUES (
          'legacy-stage', 'project-1', 'task-1', 'work', 'codex', 'gpt-5', 'full-access',
          'completed', '2026-07-17T00:00:00.000Z', '2026-07-17T00:01:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 57 });
      const legacyRows = yield* sql<{
        readonly capabilityTier: string | null;
        readonly modelOptions: string | null;
      }>`
        SELECT capability_tier AS "capabilityTier", model_options_json AS "modelOptions"
        FROM projection_stage_history
        WHERE stage_thread_id = 'legacy-stage'
      `;
      assert.deepStrictEqual(legacyRows[0], { capabilityTier: null, modelOptions: null });
    }),
  );
});
