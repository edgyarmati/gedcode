import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionPendingGateInput,
  ListProjectionPendingGatesByTaskInput,
  ProjectionPendingGate,
  ProjectionPendingGateRepository,
  type ProjectionPendingGateRepositoryShape,
} from "../Services/ProjectionPendingGates.ts";

const { pullRequest: _pullRequest, ...projectionPendingGateFields } = ProjectionPendingGate.fields;
const ProjectionPendingGateRow = Schema.Struct({
  ...projectionPendingGateFields,
  pullRequestTitle: Schema.NullOr(Schema.String),
  pullRequestBody: Schema.NullOr(Schema.String),
});

type ProjectionPendingGateRow = typeof ProjectionPendingGateRow.Type;

const fromRow = (row: ProjectionPendingGateRow): ProjectionPendingGate => {
  const { pullRequestTitle, pullRequestBody, ...gate } = row;
  return {
    ...gate,
    pullRequest:
      pullRequestTitle === null || pullRequestBody === null
        ? null
        : { title: pullRequestTitle, body: pullRequestBody },
  };
};

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
          pull_request_title,
          pull_request_body,
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
          ${row.pullRequest?.title ?? null},
          ${row.pullRequest?.body ?? null},
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
          pull_request_title = excluded.pull_request_title,
          pull_request_body = excluded.pull_request_body,
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
    Result: ProjectionPendingGateRow,
    execute: ({ gateId }) =>
      sql`
        SELECT
          gate_id AS "gateId",
          task_id AS "taskId",
          gate,
          content_hash AS "contentHash",
          pull_request_title AS "pullRequestTitle",
          pull_request_body AS "pullRequestBody",
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
    Result: ProjectionPendingGateRow,
    execute: ({ taskId }) =>
      sql`
        SELECT
          gate_id AS "gateId",
          task_id AS "taskId",
          gate,
          content_hash AS "contentHash",
          pull_request_title AS "pullRequestTitle",
          pull_request_body AS "pullRequestBody",
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
      Effect.map(Option.map(fromRow)),
      Effect.mapError(toPersistenceSqlError("ProjectionPendingGateRepository.getByGateId:query")),
    );

  const listByTaskId: ProjectionPendingGateRepositoryShape["listByTaskId"] = (input) =>
    listProjectionPendingGateRowsByTask(input).pipe(
      Effect.map((rows) => rows.map(fromRow)),
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
