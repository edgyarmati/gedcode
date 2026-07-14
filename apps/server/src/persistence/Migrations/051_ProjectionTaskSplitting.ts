import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_tasks ADD COLUMN parent_task_id TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN child_order INTEGER`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN aggregate_progress_json TEXT`;
  yield* sql`
    CREATE UNIQUE INDEX idx_projection_tasks_parent_child_order
    ON projection_tasks(parent_task_id, child_order)
    WHERE parent_task_id IS NOT NULL
  `;
});
