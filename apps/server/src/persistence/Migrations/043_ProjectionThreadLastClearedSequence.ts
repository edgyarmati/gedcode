import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 043 — Persist the event-log boundary for thread clears.
 *
 * Existing rows remain null until a future `thread.cleared` event records the
 * sequence that should clamp replayed thread detail events.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN last_cleared_sequence INTEGER
  `;
});
