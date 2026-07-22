import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 073 — durable episode number for PM lifecycle delivery attention.
 *
 * A settlement may be held, recovered, then held again. The monotonically
 * increasing episode retains each transition as a distinct PM activity while
 * keeping the durable settlement row as the source of truth.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE pm_consumed_settlements
    ADD COLUMN delivery_episode INTEGER NOT NULL DEFAULT 0
  `;
});
