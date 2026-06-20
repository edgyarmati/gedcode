import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 038 — add two-phase PM settlement consumption status.
 *
 * Existing settlement markers are backfilled to `acted` by SQLite's defaulted
 * ADD COLUMN behavior. New runtime consumes insert `pending` before prompting
 * the PM and flip to `acted` only after the PM re-entry queue drains.
 *
 * DDL-only; the append-only orchestration event log is untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE pm_consumed_settlements
    ADD COLUMN status TEXT NOT NULL DEFAULT 'acted'
  `;
});
