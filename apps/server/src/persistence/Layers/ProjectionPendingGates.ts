import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionPendingGateInput,
  ListProjectionPendingGatesByTaskInput,
  ProjectionPendingGate,
  ProjectionPendingGateRepository,
  type ProjectionPendingGateRepositoryShape,
} from "../Services/ProjectionPendingGates.ts";

const makeProjectionPendingGateRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionPendingGateRow = SqlSchema.void({
    Request: ProjectionPendingGate,
    execute: (row) =>
      sql`
        INSERT INTO projection_pending_gates (
          gate_id,
          task_id,
          gate,
          content_hash,
          stage_thread_id,
          status,
          approved_hash,
          decision,
          origin,
          requested_at,
          resolved_at
        )
        VALUES (
          ${row.gateId},
          ${row.taskId},
          ${row.gate},
          ${row.contentHash},
          ${row.stageThreadId},
          ${row.status},
          ${row.approvedHash},
          ${row.decision},
          ${row.origin},
          ${row.requestedAt},
          ${row.resolvedAt}
        )
        ON CONFLICT (gate_id)
        DO UPDATE SET
          task_id = excluded.task_id,
          gate = excluded.gate,
          content_hash = excluded.content_hash,
          stage_thread_id = excluded.stage_thread_id,
          status = excluded.status,
          approved_hash = excluded.approved_hash,
          decision = excluded.decision,
          origin = excluded.origin,
          requested_at = excluded.requested_at,
          resolved_at = excluded.resolved_at
      `,
  });

  const getProjectionPendingGateRow = SqlSchema.findOneOption({
    Request: GetProjectionPendingGateInput,
    Result: ProjectionPendingGate,
    execute: ({ gateId }) =>
      sql`
        SELECT
          gate_id AS "gateId",
          task_id AS "taskId",
          gate,
          content_hash AS "contentHash",
          stage_thread_id AS "stageThreadId",
          status,
          approved_hash AS "approvedHash",
          decision,
          origin,
          requested_at AS "requestedAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_gates
        WHERE gate_id = ${gateId}
      `,
  });

  const listProjectionPendingGateRowsByTask = SqlSchema.findAll({
    Request: ListProjectionPendingGatesByTaskInput,
    Result: ProjectionPendingGate,
    execute: ({ taskId }) =>
      sql`
        SELECT
          gate_id AS "gateId",
          task_id AS "taskId",
          gate,
          content_hash AS "contentHash",
          stage_thread_id AS "stageThreadId",
          status,
          approved_hash AS "approvedHash",
          decision,
          origin,
          requested_at AS "requestedAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_gates
        WHERE task_id = ${taskId}
        ORDER BY requested_at ASC, gate_id ASC
      `,
  });

  const upsert: ProjectionPendingGateRepositoryShape["upsert"] = (row) =>
    upsertProjectionPendingGateRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionPendingGateRepository.upsert:query")),
    );

  const getByGateId: ProjectionPendingGateRepositoryShape["getByGateId"] = (input) =>
    getProjectionPendingGateRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionPendingGateRepository.getByGateId:query")),
    );

  const listByTaskId: ProjectionPendingGateRepositoryShape["listByTaskId"] = (input) =>
    listProjectionPendingGateRowsByTask(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionPendingGateRepository.listByTaskId:query")),
    );

  return {
    upsert,
    getByGateId,
    listByTaskId,
  } satisfies ProjectionPendingGateRepositoryShape;
});

export const ProjectionPendingGateRepositoryLive = Layer.effect(
  ProjectionPendingGateRepository,
  makeProjectionPendingGateRepository,
);
