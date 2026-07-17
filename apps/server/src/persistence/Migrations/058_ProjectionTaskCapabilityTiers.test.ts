import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("058_ProjectionTaskCapabilityTiers", (it) => {
  it.effect("clears retired raw task backends before the column stores semantic tiers", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 57 });
      yield* sql`
        INSERT INTO projection_tasks (
          task_id, project_id, type, title, status, branch, worktree_path, pm_message_id,
          stage_thread_ids_json, current_stage_thread_id, role_model_selections_json,
          playbook_version, created_at, updated_at
        ) VALUES (
          'task-1', 'project-1', 'feature', 'Task', 'draft', NULL, NULL, NULL,
          '[]', NULL, '{"work":{"instanceId":"codex","model":"gpt-old"}}',
          NULL, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 58 });
      const rows = yield* sql<{ readonly tiers: string }>`
        SELECT role_model_selections_json AS tiers FROM projection_tasks WHERE task_id = 'task-1'
      `;
      assert.strictEqual(rows[0]?.tiers, "{}");
    }),
  );
});
