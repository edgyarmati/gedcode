import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Expand terminal context resolutions to include clean server-applied maintenance. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP INDEX projection_project_context_runs_active_idx`;
  yield* sql`DROP INDEX projection_project_context_runs_project_updated_idx`;
  yield* sql`
    ALTER TABLE projection_project_context_runs
    RENAME TO projection_project_context_runs_063
  `;
  yield* sql`
    CREATE TABLE projection_project_context_runs (
      project_context_run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('populate', 'review')),
      tier TEXT NOT NULL CHECK (tier IN ('cheap', 'smart', 'genius')),
      provider_instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      model_options_json TEXT,
      primary_checkout_path TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      fingerprint TEXT NOT NULL,
      prompt TEXT NOT NULL,
      baseline_manifest_json TEXT NOT NULL,
      workspace_status_manifest_json TEXT NOT NULL,
      git_state_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'pending-review', 'completed', 'discarded', 'failed', 'interrupted')),
      provider_thread_id TEXT,
      result TEXT,
      failure_message TEXT,
      changes_json TEXT NOT NULL,
      scope_violation_paths_json TEXT NOT NULL,
      resolution TEXT CHECK (resolution IS NULL OR resolution IN ('applied', 'committed', 'discarded')),
      commit_hash TEXT,
      result_schema_version INTEGER CHECK (result_schema_version IS NULL OR result_schema_version > 0),
      result_fingerprint TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      pending_review_at TEXT,
      failed_at TEXT,
      interrupted_at TEXT,
      resolved_at TEXT,
      updated_at TEXT NOT NULL,
      pm_start_state TEXT NOT NULL DEFAULT 'ready'
        CHECK (pm_start_state IN ('ready', 'awaiting-user', 'waiting-for-idle', 'interrupting')),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;
  yield* sql`
    INSERT INTO projection_project_context_runs (
      project_context_run_id, project_id, mode, tier, provider_instance_id, model,
      model_options_json, primary_checkout_path, schema_version, fingerprint, prompt,
      baseline_manifest_json, workspace_status_manifest_json, git_state_json, status,
      provider_thread_id, result, failure_message, changes_json, scope_violation_paths_json,
      resolution, commit_hash, result_schema_version, result_fingerprint, created_at,
      started_at, pending_review_at, failed_at, interrupted_at, resolved_at, updated_at,
      pm_start_state
    )
    SELECT
      project_context_run_id, project_id, mode, tier, provider_instance_id, model,
      model_options_json, primary_checkout_path, schema_version, fingerprint, prompt,
      baseline_manifest_json, workspace_status_manifest_json, git_state_json, status,
      provider_thread_id, result, failure_message, changes_json, scope_violation_paths_json,
      resolution, commit_hash, result_schema_version, result_fingerprint, created_at,
      started_at, pending_review_at, failed_at, interrupted_at, resolved_at, updated_at,
      pm_start_state
    FROM projection_project_context_runs_063
  `;
  yield* sql`DROP TABLE projection_project_context_runs_063`;
  yield* sql`CREATE INDEX projection_project_context_runs_project_updated_idx ON projection_project_context_runs(project_id, updated_at, project_context_run_id)`;
  yield* sql`
    CREATE INDEX projection_project_context_runs_active_idx
    ON projection_project_context_runs(project_id, status, updated_at, project_context_run_id)
    WHERE status IN ('pending', 'running', 'pending-review')
  `;
});
