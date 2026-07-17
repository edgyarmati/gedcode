import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN change_review_json TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN verification_json TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN no_changes_needed_json TEXT`;
});
