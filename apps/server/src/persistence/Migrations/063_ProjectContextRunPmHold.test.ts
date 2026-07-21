import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("063_ProjectContextRunPmHold", (it) => {
  it.effect("backfills ready and persists every pre-start arbitration state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 62 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          role_model_selections_json, role_prompt_prefixes_json, orchestrator_config_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-before-063', 'Before 063', '/repo', NULL, '{}', '{}', '{}', '[]',
          '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_project_context_runs (
          project_context_run_id, project_id, mode, tier, provider_instance_id, model,
          primary_checkout_path, schema_version, fingerprint, prompt,
          baseline_manifest_json, workspace_status_manifest_json, git_state_json, status,
          changes_json, scope_violation_paths_json, created_at, updated_at
        ) VALUES (
          'context-run-before-063', 'project-before-063', 'review', 'smart', 'codex', 'gpt',
          '/repo', 1, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'Review context.', '[]', '[]', '{}', 'pending', '[]', '[]',
          '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 63 });
      const initial = yield* sql<{ readonly pmStartState: string }>`
        SELECT pm_start_state AS "pmStartState"
        FROM projection_project_context_runs
        WHERE project_context_run_id = 'context-run-before-063'
      `;
      assert.deepStrictEqual(initial, [{ pmStartState: "ready" }]);

      for (const state of ["awaiting-user", "waiting-for-idle", "interrupting", "ready"]) {
        yield* sql`
          UPDATE projection_project_context_runs
          SET pm_start_state = ${state}
          WHERE project_context_run_id = 'context-run-before-063'
        `;
      }
    }),
  );
});
