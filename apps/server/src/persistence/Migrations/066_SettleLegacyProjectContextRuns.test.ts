import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "066_SettleLegacyProjectContextRuns",
  (it) => {
    it.effect("interrupts active legacy runs without changing terminal history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 65 });
        yield* sql`
          INSERT INTO projection_projects (
            project_id, title, workspace_root, default_model_selection_json,
            role_model_selections_json, role_prompt_prefixes_json, orchestrator_config_json,
            scripts_json, created_at, updated_at, deleted_at
          ) VALUES (
            'project-before-066', 'Before 066', '/repo', NULL, '{}', '{}', '{}', '[]',
            '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', NULL
          )
        `;

        for (const [id, status] of [
          ["pending", "pending"],
          ["running", "running"],
          ["review", "pending-review"],
          ["completed", "completed"],
          ["failed", "failed"],
        ] as const) {
          yield* sql`
            INSERT INTO projection_project_context_runs (
              project_context_run_id, project_id, mode, tier, provider_instance_id, model,
              primary_checkout_path, schema_version, fingerprint, prompt,
              baseline_manifest_json, workspace_status_manifest_json, git_state_json, status,
              changes_json, scope_violation_paths_json, created_at, updated_at, pm_start_state
            ) VALUES (
              ${id}, 'project-before-066', 'review', 'smart', 'codex', 'gpt', '/repo', 1,
              'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              'Review context.', '[]', '[]', '{}', ${status}, '[]', '[]',
              '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', 'awaiting-user'
            )
          `;
        }

        yield* runMigrations({ toMigrationInclusive: 66 });
        const rows = yield* sql<{
          readonly id: string;
          readonly status: string;
          readonly failureMessage: string | null;
          readonly interruptedAt: string | null;
          readonly pmStartState: string;
        }>`
          SELECT project_context_run_id AS id, status,
            failure_message AS "failureMessage", interrupted_at AS "interruptedAt",
            pm_start_state AS "pmStartState"
          FROM projection_project_context_runs
          ORDER BY project_context_run_id
        `;

        for (const row of rows.filter((row) => ["pending", "review", "running"].includes(row.id))) {
          assert.strictEqual(row.status, "interrupted");
          assert.strictEqual(
            row.failureMessage,
            "Cancelled by upgrade to the manifest-owned project-context lifecycle.",
          );
          assert.notStrictEqual(row.interruptedAt, null);
          assert.strictEqual(row.pmStartState, "ready");
        }
        assert.strictEqual(rows.find((row) => row.id === "completed")?.status, "completed");
        assert.strictEqual(rows.find((row) => row.id === "completed")?.failureMessage, null);
        assert.strictEqual(rows.find((row) => row.id === "failed")?.status, "failed");
        assert.strictEqual(rows.find((row) => row.id === "failed")?.failureMessage, null);
      }),
    );
  },
);
