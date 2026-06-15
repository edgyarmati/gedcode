import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetPmRuntimeCursorInput,
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
          consumed_at AS "consumedAt"
        FROM pm_consumed_settlements
        WHERE project_id = ${projectId}
          AND kind = ${kind}
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

  const consumeSettlementAndAdvanceCursor: PmRuntimeStateRepositoryShape["consumeSettlementAndAdvanceCursor"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`
            INSERT OR IGNORE INTO pm_consumed_settlements (
              project_id,
              kind,
              settlement_key,
              consumed_at
            )
            VALUES (
              ${input.projectId},
              ${input.kind},
              ${input.settlementKey},
              ${input.consumedAt}
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
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "PmRuntimeStateRepository.consumeSettlementAndAdvanceCursor:query",
            ),
          ),
        );

  return {
    getCursor,
    listConsumedSettlements,
    consumeSettlementAndAdvanceCursor,
  } satisfies PmRuntimeStateRepositoryShape;
});

export const PmRuntimeStateRepositoryLive = Layer.effect(
  PmRuntimeStateRepository,
  makePmRuntimeStateRepository,
);
