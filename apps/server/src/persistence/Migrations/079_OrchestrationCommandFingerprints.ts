import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const LEGACY_COMMAND_FINGERPRINT = `sha256:${"0".repeat(64)}`;

/**
 * Bind every new command receipt to the exact command content it acknowledges.
 *
 * Historical receipts did not retain enough command data to reconstruct a
 * fingerprint. Preserve them with a reserved sentinel so any post-upgrade
 * reuse fails closed instead of being mistaken for an exact retry.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE orchestration_command_receipts_fingerprinted (
      command_id TEXT PRIMARY KEY,
      command_fingerprint TEXT NOT NULL,
      aggregate_kind TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `;

  yield* sql`
    INSERT INTO orchestration_command_receipts_fingerprinted (
      command_id,
      command_fingerprint,
      aggregate_kind,
      aggregate_id,
      accepted_at,
      result_sequence,
      status,
      error
    )
    SELECT
      command_id,
      ${LEGACY_COMMAND_FINGERPRINT},
      aggregate_kind,
      aggregate_id,
      accepted_at,
      result_sequence,
      status,
      error
    FROM orchestration_command_receipts
  `;

  yield* sql`DROP TABLE orchestration_command_receipts`;
  yield* sql`
    ALTER TABLE orchestration_command_receipts_fingerprinted
    RENAME TO orchestration_command_receipts
  `;

  yield* sql`
    CREATE INDEX idx_orch_command_receipts_aggregate
    ON orchestration_command_receipts(aggregate_kind, aggregate_id)
  `;
  yield* sql`
    CREATE INDEX idx_orch_command_receipts_sequence
    ON orchestration_command_receipts(result_sequence)
  `;
});
