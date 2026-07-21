import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const RETIRED_EVENT_TYPES = [
  "project.context-dismissed",
  "project.context-completed",
  "project.context-run-revised",
  "project.context-run-committed",
  "project.context-run-discarded",
] as const;

/** Remove the replaced modal-onboarding event and projection state. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    DELETE FROM orchestration_events
    WHERE event_type IN ${sql.in(RETIRED_EVENT_TYPES)}
  `;

  // Compaction can create stream-version gaps. Use a negative temporary space
  // so the unique stream/version index remains valid during renumbering.
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

  yield* sql`
    ALTER TABLE projection_projects
    DROP COLUMN project_context_onboarding_json
  `;
});
