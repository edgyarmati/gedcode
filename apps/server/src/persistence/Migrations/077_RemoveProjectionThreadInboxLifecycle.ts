import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const RETIRED_INBOX_EVENT_TYPES = [
  "thread.inbox-settled",
  "thread.inbox-snoozed",
  "thread.inbox-reopened",
] as const;

/** Remove persisted state for the withdrawn normal-thread Inbox lifecycle. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DELETE FROM orchestration_events
    WHERE event_type IN ${sql.in(RETIRED_INBOX_EVENT_TYPES)}
  `;

  // Removing events creates gaps in aggregate stream versions. Renumber through
  // a temporary negative space so the unique stream/version index stays valid.
  yield* sql`UPDATE orchestration_events SET stream_version = -sequence`;
  yield* sql`
    WITH ranked_events AS (
      SELECT
        sequence,
        ROW_NUMBER() OVER (
          PARTITION BY aggregate_kind, stream_id
          ORDER BY sequence
        ) AS compacted_stream_version
      FROM orchestration_events
    )
    UPDATE orchestration_events
    SET stream_version = (
      SELECT compacted_stream_version
      FROM ranked_events
      WHERE ranked_events.sequence = orchestration_events.sequence
    )
  `;

  yield* sql`ALTER TABLE projection_threads DROP COLUMN inbox_lifecycle`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN inbox_wake_at`;
});
