import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_stage_history ADD COLUMN runtime_mode TEXT`;
  yield* sql`
    UPDATE projection_stage_history
    SET runtime_mode = (
      SELECT projection_threads.runtime_mode
      FROM projection_threads
      WHERE projection_threads.thread_id = projection_stage_history.stage_thread_id
    )
    WHERE runtime_mode IS NULL
  `;
});
