import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
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
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'pending-review', 'failed', 'interrupted')),
      provider_thread_id TEXT,
      result TEXT,
      failure_message TEXT,
      changes_json TEXT NOT NULL,
      scope_violation_paths_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      pending_review_at TEXT,
      failed_at TEXT,
      interrupted_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;
  yield* sql`CREATE INDEX projection_project_context_runs_project_updated_idx ON projection_project_context_runs(project_id, updated_at, project_context_run_id)`;
  yield* sql`
    CREATE INDEX projection_project_context_runs_active_idx
    ON projection_project_context_runs(project_id, status, updated_at, project_context_run_id)
    WHERE status IN ('pending', 'running', 'pending-review')
  `;
});
