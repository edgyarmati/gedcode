import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 040 — `projection_quota_blocked_stages`: derived open/history rows for
 * stages paused by provider-instance quota exhaustion.
 *
 * The table is projector-owned and derived from `task.stage-blocked` and the
 * subsequent resumed `task.stage-started`. It lets the runtime resume open
 * quota-blocked stages and enforce bounded retry counts without adding mutable
 * retry columns to `projection_tasks`.
 *
 * DDL-only; the append-only orchestration event log is untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_quota_blocked_stages (
      stage_thread_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      reset_at TEXT,
      status TEXT NOT NULL DEFAULT 'blocked',
      retry_count INTEGER NOT NULL,
      blocked_at TEXT NOT NULL,
      resumed_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_quota_blocked_stages_provider_status
    ON projection_quota_blocked_stages(provider_instance_id, status, blocked_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_quota_blocked_stages_task_role_status
    ON projection_quota_blocked_stages(task_id, role, status)
  `;
});
