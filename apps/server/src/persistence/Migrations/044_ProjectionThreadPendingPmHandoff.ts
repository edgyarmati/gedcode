import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 044 — Persist pending PM harness handoff bootstrap context on thread shells.
 *
 * The value is nullable JSON because it is derived read-model state. Replaying
 * `thread.pm-handoff-requested`, `thread.pm-handoff-completed`, and
 * `thread.cleared` events fully reconstructs it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN pending_pm_handoff_json TEXT
  `;
});
