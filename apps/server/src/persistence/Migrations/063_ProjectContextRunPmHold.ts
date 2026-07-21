import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Persist pre-start PM arbitration so context holds survive reconnects and restarts. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE projection_project_context_runs
    ADD COLUMN pm_start_state TEXT NOT NULL DEFAULT 'ready'
      CHECK (pm_start_state IN ('ready', 'awaiting-user', 'waiting-for-idle', 'interrupting'))
  `;
});
