import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const UPGRADE_INTERRUPTION_REASON =
  "Cancelled by upgrade to the manifest-owned project-context lifecycle.";

/** Retire context runs that cannot be resumed after removal of the legacy review workflow. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_project_context_runs
    SET
      status = 'interrupted',
      failure_message = ${UPGRADE_INTERRUPTION_REASON},
      interrupted_at = COALESCE(interrupted_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP,
      pm_start_state = 'ready'
    WHERE status IN ('pending', 'running', 'pending-review')
  `;
});
