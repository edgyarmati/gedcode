import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Inbox lifecycle is independent of archival. Existing threads are ordinary
 * active Inbox entries until a lifecycle event projects another state.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN inbox_lifecycle TEXT NOT NULL DEFAULT 'active'
  `;
});
