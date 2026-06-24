import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 042 — Persist opened PR URLs on the task read-model projection.
 *
 * This is derived-table DDL only. Existing event logs are still the source of
 * truth; replaying `task.pr-opened` events repopulates the nullable column.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_tasks
    ADD COLUMN pr_url TEXT
  `;
});
