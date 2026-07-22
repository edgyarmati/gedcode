import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_pending_gates ADD COLUMN pull_request_title TEXT`;
  yield* sql`ALTER TABLE projection_pending_gates ADD COLUMN pull_request_body TEXT`;
});
