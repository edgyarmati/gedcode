import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_tasks
    ADD COLUMN acceptance_criteria_json TEXT NOT NULL DEFAULT '[]'
  `;
  yield* sql`
    ALTER TABLE projection_tasks
    ADD COLUMN depends_on_task_ids_json TEXT NOT NULL DEFAULT '[]'
  `;
});
