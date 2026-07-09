import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 035 — `pm_session_entries` (+ `pm_sessions`): legacy PM session tables from
 * the pi-era PM runtime (Plan 018 WP-C; design §11 step 4, PM runtime WP-G).
 * The old adapter is gone; these append-only migration tables stay registered
 * so existing databases migrate predictably and clear-chat can delete legacy
 * rows when present.
 *
 * Historical shape: the session was a **tree** keyed by `parentId`, with a
 * single mutable **leaf pointer**, over a discriminated session-entry union.
 *
 * `pm_sessions` — one row per legacy PM session, backing `getMetadata()`
 *   (`SessionMetadata { id, createdAt }`) and `getLeafId()`/`setLeafId()`
 *   (`leaf_id` nullable string pointer; `null` is a valid "no leaf" value).
 *
 * `pm_session_entries` — one row per `SessionTreeEntry`, backing `appendEntry`,
 *   `getEntry`, `findEntries(type)`, `getEntries`, `getPathToRoot(leafId)` and
 *   `getLabel(id)`. Columns map to `SessionTreeEntryBase`:
 *     - `entry_id`         ← `id`        (createEntryId; PK)
 *     - `parent_id`        ← `parentId`  (nullable; the tree edge — root is NULL)
 *     - `timestamp`        ← `timestamp` (ISO string)
 *     - `type`             ← `type`      (the discriminant: `message`,
 *                                          `compaction`, `branch_summary`,
 *                                          `label`, `leaf`, `model_change`,
 *                                          `thinking_level_change`,
 *                                          `active_tools_change`, `custom`,
 *                                          `custom_message`, `session_info`)
 *     - `payload_json`     ← the remaining type-specific fields of the matched
 *                            union variant, stored verbatim as JSON (SQLite has
 *                            no union/record column). The adapter re-attaches
 *                            `id`/`parentId`/`timestamp`/`type` on read so the
 *                            reconstructed object satisfies `SessionTreeEntry`.
 *
 *   `session_id` scopes entries to their legacy PM session and references `pm_sessions`.
 *   The `(session_id, type)` index serves `findEntries(type)`; the
 *   `(session_id, parent_id)` index serves the `getPathToRoot` walk.
 *
 * DDL-only — no backfill (PM sessions are created at runtime). The orchestration
 * event log is untouched: this is legacy PM private memory, distinct from
 * the append-only domain event log.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_sessions (
      session_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      leaf_id TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_session_entries (
      entry_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pm_session_entries_session_type
    ON pm_session_entries(session_id, type)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_pm_session_entries_session_parent
    ON pm_session_entries(session_id, parent_id)
  `;
});
