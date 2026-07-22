import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Stores ownership only for threads created after ownership metadata exists.
 * Existing rows stay NULL so they remain visible as unclassified Chat threads.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN orchestration_ownership_json TEXT`;
});
