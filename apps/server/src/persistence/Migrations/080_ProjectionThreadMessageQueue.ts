import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Persist the server-authoritative normal-chat FIFO and its per-thread preference. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN queued_messages_json TEXT NOT NULL DEFAULT '[]'
  `;
  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN message_queue_enabled INTEGER NOT NULL DEFAULT 1
  `;
});
