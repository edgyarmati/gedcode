import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN supersedes_task_id TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN superseded_by_task_id TEXT`;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_tasks_superseded_by
    ON projection_tasks(supersedes_task_id)
    WHERE supersedes_task_id IS NOT NULL
  `;
});
