import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 034 — `projection_awaited_stages` + `projection_pending_gates`: the two
 * reconciliation sources the PM runtime replays on boot to re-enter cleanly
 * (Plan 018 WP-C; design §11 step 4, durability barrier WP-H).
 *
 * Both are projector-owned read models derived from the `task.*` event log; the
 * PM never writes them directly. On re-entry the runtime asks "which stages did
 * a worker get dispatched to that haven't reported back?" and "which gates were
 * requested that no human/client has resolved?" — these tables answer exactly
 * those, so a PM restart resumes from the durable truth rather than in-memory
 * state.
 *
 * `projection_awaited_stages` — one row per dispatched-but-unsettled stage.
 *   Mirrors `TaskStageStartedPayload`/`TaskStageCompletedPayload`
 *   (orchestration.ts): a `task.stage-started` opens a row (`awaited`), the
 *   matching `task.stage-completed` settles it (`completed_at` set). Keyed by
 *   `(task_id, stage_thread_id)` because a task drives one stage thread at a
 *   time per role; `awaited_turn_id` is the worker turn the PM is blocked on.
 *
 * `projection_pending_gates` — one row per requested-but-unresolved gate.
 *   Mirrors `TaskGateRequestedPayload`/`TaskGateResolvedPayload`: a
 *   `task.gate-requested` opens the gate (`pending`); a human/client-origin
 *   `task.gate-resolved` settles it (`decision`/`origin`/`resolved_at` set —
 *   the decider rejects `pm-runtime` origin, WP-E). `content_hash` /
 *   `approved_hash` pin the artifact the gate guards so a stale re-request is
 *   detectable.
 *
 * DDL-only — no backfill (the slice introduces the `task` aggregate). The event
 * log is untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_awaited_stages (
      task_id TEXT NOT NULL,
      stage_thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      awaited_turn_id TEXT,
      status TEXT NOT NULL DEFAULT 'awaited',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (task_id, stage_thread_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_awaited_stages_task_status
    ON projection_awaited_stages(task_id, status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_awaited_stages_status
    ON projection_awaited_stages(status)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_pending_gates (
      gate_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      gate TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      stage_thread_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_hash TEXT,
      decision TEXT,
      origin TEXT,
      requested_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_pending_gates_task_status
    ON projection_pending_gates(task_id, status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_pending_gates_status
    ON projection_pending_gates(status)
  `;
});
