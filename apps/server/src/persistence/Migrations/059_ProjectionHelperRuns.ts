import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE projection_helper_runs (
      helper_run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      attachment_json TEXT NOT NULL,
      access_mode TEXT NOT NULL CHECK (access_mode = 'read-only'),
      tier TEXT NOT NULL CHECK (tier IN ('cheap', 'smart', 'genius')),
      provider_instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      model_options_json TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'interrupted')),
      provider_thread_id TEXT,
      result TEXT,
      failure_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;
  yield* sql`CREATE INDEX projection_helper_runs_project_idx ON projection_helper_runs(project_id, created_at, helper_run_id)`;
  yield* sql`CREATE INDEX projection_helper_runs_status_idx ON projection_helper_runs(status, updated_at)`;
});
