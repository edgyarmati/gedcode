import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "062_ProjectContextRunReviewResolution",
  (it) => {
    it.effect("preserves existing runs while adding terminal review metadata", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 61 });
        yield* sql`
          INSERT INTO projection_projects (
            project_id, title, workspace_root, default_model_selection_json,
            role_model_selections_json, role_prompt_prefixes_json, orchestrator_config_json,
            scripts_json, created_at, updated_at, deleted_at
          ) VALUES (
            'project-before-062', 'Before 062', '/repo', NULL, '{}', '{}', '{}', '[]',
            '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z', NULL
          )
        `;
        yield* sql`
          INSERT INTO projection_project_context_runs (
            project_context_run_id, project_id, mode, tier, provider_instance_id, model,
            primary_checkout_path, schema_version, fingerprint, prompt,
            baseline_manifest_json, workspace_status_manifest_json, git_state_json, status,
            changes_json, scope_violation_paths_json, created_at, updated_at
          ) VALUES (
            'context-run-before-062', 'project-before-062', 'review', 'smart', 'codex', 'gpt',
            '/repo', 1, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Review context.',
            '[]', '[]', '{}', 'pending-review', '[]', '[]',
            '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'
          )
        `;

        yield* runMigrations({ toMigrationInclusive: 62 });

        const rows = yield* sql<{
          readonly status: string;
          readonly resolution: string | null;
          readonly commitHash: string | null;
          readonly resultSchemaVersion: number | null;
          readonly resultFingerprint: string | null;
          readonly resolvedAt: string | null;
        }>`
          SELECT
            status, resolution, commit_hash AS "commitHash",
            result_schema_version AS "resultSchemaVersion",
            result_fingerprint AS "resultFingerprint", resolved_at AS "resolvedAt"
          FROM projection_project_context_runs
          WHERE project_context_run_id = 'context-run-before-062'
        `;
        assert.deepStrictEqual(rows, [
          {
            status: "pending-review",
            resolution: null,
            commitHash: null,
            resultSchemaVersion: null,
            resultFingerprint: null,
            resolvedAt: null,
          },
        ]);

        yield* sql`
          UPDATE projection_project_context_runs
          SET
            status = 'completed',
            resolution = 'committed',
            commit_hash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            result_schema_version = 2,
            result_fingerprint = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            resolved_at = '2026-07-20T00:01:00.000Z'
          WHERE project_context_run_id = 'context-run-before-062'
        `;
        const completed = yield* sql<{
          readonly status: string;
          readonly resolution: string | null;
          readonly commitHash: string | null;
        }>`
          SELECT status, resolution, commit_hash AS "commitHash"
          FROM projection_project_context_runs
          WHERE project_context_run_id = 'context-run-before-062'
        `;
        assert.deepStrictEqual(completed, [
          {
            status: "completed",
            resolution: "committed",
            commitHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        ]);
      }),
    );
  },
);
