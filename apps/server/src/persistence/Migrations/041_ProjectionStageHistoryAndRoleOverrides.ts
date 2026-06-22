import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 041 — Role-specific orchestration config persistence and stage-history
 * projection.
 *
 * Adds project prompt prefixes, task-level model overrides, and a durable
 * stage-history table keyed by stage thread id. All values are projection-owned
 * and rebuilt from the orchestration event log.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN role_prompt_prefixes_json TEXT NOT NULL DEFAULT '{}'
  `;

  yield* sql`
    ALTER TABLE projection_tasks
    ADD COLUMN role_model_selections_json TEXT NOT NULL DEFAULT '{}'
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_stage_history (
      stage_thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_stage_history_project_started
    ON projection_stage_history(project_id, started_at, stage_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_stage_history_task_started
    ON projection_stage_history(task_id, started_at, stage_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_stage_history_status_started
    ON projection_stage_history(status, started_at, stage_thread_id)
  `;
});
