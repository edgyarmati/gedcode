import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Persists deadlines for worker capability pauses without rewriting history. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE projection_stage_history
    ADD COLUMN capability_pause_expires_at TEXT NULL
  `;
});
