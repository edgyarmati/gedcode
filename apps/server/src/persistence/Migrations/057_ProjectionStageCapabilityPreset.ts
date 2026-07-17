import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Records the chosen capability tier and complete resolved model options per stage attempt. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_stage_history ADD COLUMN capability_tier TEXT`;
  yield* sql`ALTER TABLE projection_stage_history ADD COLUMN model_options_json TEXT`;
});
