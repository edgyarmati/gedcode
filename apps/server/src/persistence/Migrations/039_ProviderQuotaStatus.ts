import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 039 — `projection_provider_quota_status`: derived per-provider-instance quota
 * state for orchestrator admission/resumption.
 *
 * Rows are projector-owned runtime read models derived from WP-Q1 provider
 * runtime telemetry and classified rate-limit errors. Missing row means `ok`.
 *
 * DDL-only; the append-only orchestration event log is untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_provider_quota_status (
      provider_instance_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      reset_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_provider_quota_status_status
    ON projection_provider_quota_status(status, reset_at)
  `;
});
