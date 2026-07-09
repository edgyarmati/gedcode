import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 033 — `projection_tasks`: the read-model row for the `task` aggregate
 * (Plan 018 WP-C; design §11 step 4).
 *
 * Columns mirror `OrchestrationTask` (packages/contracts/src/orchestration.ts):
 * `id, projectId, type, title, status, branch, worktreePath, pmMessageId,
 * stageThreadIds[], currentStageThreadId, playbookVersion, createdAt, updatedAt`.
 *
 * `status` is **DERIVED** by the projector (WP-D) from the `task.*` event log —
 * there is intentionally no `task.status.set` command. This migration only
 * provisions the column; nothing writes a status here by hand. The closed
 * `OrchestrationTaskStatus` literal seeds the `'draft'` default so a freshly
 * inserted row before the projector runs is still safe-by-default.
 *
 * `stage_thread_ids_json` stores the `stageThreadIds` array as a JSON text
 * column (SQLite has no array type); the projector encodes/decodes it.
 *
 * DDL-only — no backfill (the slice introduces the `task` aggregate; there are
 * no pre-existing task events to project). The event log is untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_tasks (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      branch TEXT,
      worktree_path TEXT,
      pm_message_id TEXT,
      stage_thread_ids_json TEXT NOT NULL DEFAULT '[]',
      current_stage_thread_id TEXT,
      playbook_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_tasks_project_status
    ON projection_tasks(project_id, status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_tasks_project_updated
    ON projection_tasks(project_id, updated_at)
  `;
});
