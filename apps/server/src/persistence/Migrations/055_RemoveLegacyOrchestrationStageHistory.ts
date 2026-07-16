import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 055 — Remove projection rows for retired `classify` and `review` stages.
 *
 * Migration 054 cleaned role-keyed project/task settings, but the independently
 * persisted stage-history projection can still contain the retired role values.
 * Current startup decodes this table strictly and therefore cannot load those
 * rows. Stage history is a derived projection, so remove only the incompatible
 * rows while preserving tasks, threads, and the append-only event store.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM projection_stage_history
    WHERE role IN ('classify', 'review')
  `;
});
