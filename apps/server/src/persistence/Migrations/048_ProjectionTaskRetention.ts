import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN archived_at TEXT`;
  yield* sql`ALTER TABLE projection_tasks ADD COLUMN deleted_at TEXT`;
  yield* sql`
    CREATE INDEX idx_projection_tasks_active_project_updated
    ON projection_tasks(project_id, updated_at)
    WHERE archived_at IS NULL AND deleted_at IS NULL
  `;
});
