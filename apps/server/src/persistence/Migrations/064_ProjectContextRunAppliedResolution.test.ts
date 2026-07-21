import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "064_ProjectContextRunAppliedResolution",
  (it) => {
    it.effect("preserves runs and accepts an applied resolution", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 63 });
        yield* sql`
          INSERT INTO projection_projects (
            project_id, title, workspace_root, default_model_selection_json,
            role_model_selections_json, role_prompt_prefixes_json, orchestrator_config_json,
            scripts_json, created_at, updated_at, deleted_at
          ) VALUES (
            'project-before-064', 'Before 064', '/repo', NULL, '{}', '{}', '{}', '[]',
            '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
          )
        `;
        yield* sql`
          INSERT INTO projection_project_context_runs (
            project_context_run_id, project_id, mode, tier, provider_instance_id, model,
            primary_checkout_path, schema_version, fingerprint, prompt,
            baseline_manifest_json, workspace_status_manifest_json, git_state_json, status,
            changes_json, scope_violation_paths_json, created_at, updated_at, pm_start_state
          ) VALUES (
            'context-run-before-064', 'project-before-064', 'review', 'smart', 'codex', 'gpt',
            '/repo', 3, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            'Review context.', '[]', '[]', '{}', 'running', '[]', '[]',
            '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', 'waiting-for-idle'
          )
        `;

        yield* runMigrations({ toMigrationInclusive: 64 });
        yield* sql`
          UPDATE projection_project_context_runs
          SET status = 'completed', resolution = 'applied'
          WHERE project_context_run_id = 'context-run-before-064'
        `;
        const rows = yield* sql<{ readonly resolution: string; readonly pmStartState: string }>`
          SELECT resolution, pm_start_state AS "pmStartState"
          FROM projection_project_context_runs
          WHERE project_context_run_id = 'context-run-before-064'
        `;
        assert.deepStrictEqual(rows, [{ resolution: "applied", pmStartState: "waiting-for-idle" }]);
      }),
    );
  },
);
