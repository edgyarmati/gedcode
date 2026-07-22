import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import { withBusyRetry } from "../retryPolicy.ts";
import {
  GetPmRuntimeCursorInput,
  ListPendingPmSettlementsInput,
  ListPmConsumedSettlementsInput,
  PmConsumedSettlement,
  PmRuntimeCursor,
  PmRuntimeStateRepository,
  type PmRuntimeStateRepositoryShape,
} from "../Services/PmRuntimeState.ts";

const makePmRuntimeStateRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getCursorRow = SqlSchema.findOneOption({
    Request: GetPmRuntimeCursorInput,
    Result: PmRuntimeCursor,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          last_consumed_sequence AS "lastConsumedSequence",
          updated_at AS "updatedAt"
        FROM pm_runtime_cursor
        WHERE project_id = ${projectId}
      `,
  });

  const listConsumedSettlementRows = SqlSchema.findAll({
    Request: ListPmConsumedSettlementsInput,
    Result: PmConsumedSettlement,
    execute: ({ projectId, kind }) =>
      sql`
        SELECT
          project_id AS "projectId",
          kind,
          settlement_key AS "settlementKey",
          consumed_at AS "consumedAt",
          status,
          retry_attempts AS "retryAttempts",
          hold_reason AS "holdReason",
          next_retry_at AS "nextRetryAt",
          delivery_episode AS "deliveryEpisode"
        FROM pm_consumed_settlements
        WHERE project_id = ${projectId}
          AND kind = ${kind}
        ORDER BY consumed_at ASC, settlement_key ASC
      `,
  });

  const listPendingSettlementRows = SqlSchema.findAll({
    Request: ListPendingPmSettlementsInput,
    Result: PmConsumedSettlement,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          kind,
          settlement_key AS "settlementKey",
          consumed_at AS "consumedAt",
          status,
          retry_attempts AS "retryAttempts",
          hold_reason AS "holdReason",
          next_retry_at AS "nextRetryAt",
          delivery_episode AS "deliveryEpisode"
        FROM pm_consumed_settlements
        WHERE project_id = ${projectId}
          AND status = 'pending'
        ORDER BY consumed_at ASC, settlement_key ASC
      `,
  });

  const getCursor: PmRuntimeStateRepositoryShape["getCursor"] = (input) =>
    getCursorRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("PmRuntimeStateRepository.getCursor:query")),
    );

  const listConsumedSettlements: PmRuntimeStateRepositoryShape["listConsumedSettlements"] = (
    input,
  ) =>
    listConsumedSettlementRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("PmRuntimeStateRepository.listConsumedSettlements:query"),
      ),
    );

  const listPending: PmRuntimeStateRepositoryShape["listPending"] = (input) =>
    listPendingSettlementRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("PmRuntimeStateRepository.listPending:query")),
    );

  const consumeSettlementAndAdvanceCursor: PmRuntimeStateRepositoryShape["consumeSettlementAndAdvanceCursor"] =
    (input) =>
      withBusyRetry(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`
            INSERT OR IGNORE INTO pm_consumed_settlements (
              project_id,
              kind,
              settlement_key,
              consumed_at,
              status
            )
            VALUES (
              ${input.projectId},
              ${input.kind},
              ${input.settlementKey},
              ${input.consumedAt},
              'pending'
            )
          `;
            const changes = yield* sql<{ readonly changes: number }>`
            SELECT changes() AS changes
          `;
            yield* sql`
            INSERT INTO pm_runtime_cursor (
              project_id,
              last_consumed_sequence,
              updated_at
            )
            VALUES (
              ${input.projectId},
              ${input.sequence},
              ${input.consumedAt}
            )
            ON CONFLICT (project_id)
            DO UPDATE SET
              last_consumed_sequence = CASE
                WHEN excluded.last_consumed_sequence > pm_runtime_cursor.last_consumed_sequence
                  THEN excluded.last_consumed_sequence
                ELSE pm_runtime_cursor.last_consumed_sequence
              END,
              updated_at = excluded.updated_at
          `;
            return (changes[0]?.changes ?? 0) > 0;
          }),
        ),
      ).pipe(
        Effect.mapError(
          toPersistenceSqlError("PmRuntimeStateRepository.consumeSettlementAndAdvanceCursor:query"),
        ),
      );

  const markActed: PmRuntimeStateRepositoryShape["markActed"] = (input) =>
    withBusyRetry(
      sql.withTransaction(
        sql`
          UPDATE pm_consumed_settlements
          SET status = 'acted'
          WHERE project_id = ${input.projectId}
            AND kind = ${input.kind}
            AND settlement_key = ${input.settlementKey}
            AND status = 'pending'
        `,
      ),
    ).pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("PmRuntimeStateRepository.markActed:query")),
    );

  const recordDeliveryFailure: PmRuntimeStateRepositoryShape["recordDeliveryFailure"] = (input) =>
    withBusyRetry(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE pm_consumed_settlements
            SET retry_attempts = ${input.retryAttempts},
                hold_reason = ${input.holdReason},
                next_retry_at = ${input.nextRetryAt},
                delivery_episode = CASE
                  WHEN ${input.holdReason} IS NULL THEN delivery_episode
                  ELSE delivery_episode + 1
                END
            WHERE project_id = ${input.projectId}
              AND kind = ${input.kind}
              AND settlement_key = ${input.settlementKey}
              AND status = 'pending'
          `;
          const rows = yield* sql<{ readonly deliveryEpisode: number }>`
            SELECT delivery_episode AS "deliveryEpisode"
            FROM pm_consumed_settlements
            WHERE project_id = ${input.projectId}
              AND kind = ${input.kind}
              AND settlement_key = ${input.settlementKey}
          `;
          return rows[0]?.deliveryEpisode ?? 0;
        }),
      ),
    ).pipe(
      Effect.mapError(
        toPersistenceSqlError("PmRuntimeStateRepository.recordDeliveryFailure:query"),
      ),
    );

  const releaseDeliveryHolds: PmRuntimeStateRepositoryShape["releaseDeliveryHolds"] = (input) =>
    input.reasons.length === 0
      ? Effect.void
      : withBusyRetry(
          sql.withTransaction(
            sql`
              UPDATE pm_consumed_settlements
              SET hold_reason = NULL,
                  next_retry_at = NULL,
                  retry_attempts = 0
              WHERE project_id = ${input.projectId}
                AND status = 'pending'
                AND hold_reason IN (${sql.in(input.reasons)})
            `,
          ),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(
            toPersistenceSqlError("PmRuntimeStateRepository.releaseDeliveryHolds:query"),
          ),
        );

  const resetDeliveryRecovery: PmRuntimeStateRepositoryShape["resetDeliveryRecovery"] = (input) =>
    withBusyRetry(
      sql.withTransaction(
        sql`
          UPDATE pm_consumed_settlements
          SET hold_reason = NULL,
              next_retry_at = NULL,
              retry_attempts = 0
          WHERE project_id = ${input.projectId}
            AND status = 'pending'
        `,
      ),
    ).pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("PmRuntimeStateRepository.resetDeliveryRecovery:query"),
      ),
    );

  return {
    getCursor,
    listConsumedSettlements,
    consumeSettlementAndAdvanceCursor,
    markActed,
    listPending,
    recordDeliveryFailure,
    releaseDeliveryHolds,
    resetDeliveryRecovery,
  } satisfies PmRuntimeStateRepositoryShape;
});

export const PmRuntimeStateRepositoryLive = Layer.effect(
  PmRuntimeStateRepository,
  makePmRuntimeStateRepository,
);
