import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 071 — durable PM lifecycle wake recovery.
 *
 * A consumed settlement remains the source of truth for exactly-once delivery.
 * These columns add the recovery policy state needed to avoid repeatedly
 * prompting a PM after known quota, authentication, or provider failures.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE pm_consumed_settlements
    ADD COLUMN retry_attempts INTEGER NOT NULL DEFAULT 0
  `;
  yield* sql`
    ALTER TABLE pm_consumed_settlements
    ADD COLUMN hold_reason TEXT NULL CHECK (hold_reason IN ('quota', 'auth', 'provider'))
  `;
  yield* sql`
    ALTER TABLE pm_consumed_settlements
    ADD COLUMN next_retry_at TEXT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pm_consumed_settlements_pending_delivery
    ON pm_consumed_settlements(project_id, status, hold_reason, next_retry_at)
  `;
  // The retry allowance is attached to the helper identity, not process
  // memory. A recovered helper therefore retains the one-attempt bound.
  yield* sql`
    ALTER TABLE projection_helper_runs
    ADD COLUMN transient_retry_count INTEGER NOT NULL DEFAULT 0
  `;
});
