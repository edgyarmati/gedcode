import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The task JSON column previously held raw per-role model selections. Task routing now stores
 * semantic capability tiers in that projection slot, so clear the unreleased legacy values before
 * the stricter tier schema reads them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE projection_tasks SET role_model_selections_json = '{}'`;
});
