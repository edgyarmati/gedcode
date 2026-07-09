import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 036 — `pm_runtime_cursor` + `pm_consumed_settlements`: the two durable tables
 * that make PM re-entry **exactly-once** across a server restart (Plan 018
 * WP-C; design §8, §11 step 9, durability barrier WP-H step H1).
 *
 * `PmRuntime` owns one pi harness per project, so both tables are scoped by
 * `project_id` (the PM-runtime scope).
 *
 * `pm_runtime_cursor` — one row per PM runtime scope. `last_consumed_sequence`
 *   is the highest orchestration-event `sequence` the PM has consumed; on boot
 *   `PmRuntime.start` replays from it (catch-up-then-live). It is advanced in
 *   the **same transaction** that inserts the consumed-marker below, **before**
 *   the PM `prompt`, so a crash between consume and prompt cannot double-fire.
 *
 * `pm_consumed_settlements` — the consumed-marker set replacing the in-memory
 *   dedup a restart would lose. One row per settlement the PM has already
 *   re-entered on. The settlement identity is encoded as:
 *     - `kind`        — `'stage'` or `'gate'` (which settlement type).
 *     - `settlement_key` — for a stage, the `(stageThreadId, awaitedTurnId)`
 *                          pair (the durable identity of a worker turn settling);
 *                          for a gate, the `gateId`. Composed by the runtime into
 *                          a single stable key; the PK guarantees check-and-insert
 *                          is atomic so a settlement that lands during the restart
 *                          window yields exactly one re-entry.
 *   `(project_id, kind)` is indexed for the per-scope reconciliation sweep that
 *   diffs awaited/pending projections against already-consumed markers.
 *
 * DDL-only — no backfill (PM runtimes initialise their cursor at first start).
 * The append-only orchestration event log is untouched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_runtime_cursor (
      project_id TEXT PRIMARY KEY,
      last_consumed_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_consumed_settlements (
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      settlement_key TEXT NOT NULL,
      consumed_at TEXT NOT NULL,
      PRIMARY KEY (project_id, kind, settlement_key)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pm_consumed_settlements_project_kind
    ON pm_consumed_settlements(project_id, kind)
  `;
});
