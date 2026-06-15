import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ListProjectionAwaitedStagesByTaskInput,
  ProjectionAwaitedStage,
  ProjectionAwaitedStageRepository,
  type ProjectionAwaitedStageRepositoryShape,
} from "../Services/ProjectionAwaitedStages.ts";

const makeProjectionAwaitedStageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionAwaitedStageRow = SqlSchema.void({
    Request: ProjectionAwaitedStage,
    execute: (row) =>
      sql`
        INSERT INTO projection_awaited_stages (
          task_id,
          stage_thread_id,
          role,
          awaited_turn_id,
          status,
          started_at,
          completed_at
        )
        VALUES (
          ${row.taskId},
          ${row.stageThreadId},
          ${row.role},
          ${row.awaitedTurnId},
          ${row.status},
          ${row.startedAt},
          ${row.completedAt}
        )
        ON CONFLICT (task_id, stage_thread_id)
        DO UPDATE SET
          role = excluded.role,
          awaited_turn_id = excluded.awaited_turn_id,
          status = excluded.status,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at
      `,
  });

  const listProjectionAwaitedStageRowsByTask = SqlSchema.findAll({
    Request: ListProjectionAwaitedStagesByTaskInput,
    Result: ProjectionAwaitedStage,
    execute: ({ taskId }) =>
      sql`
        SELECT
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          awaited_turn_id AS "awaitedTurnId",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM projection_awaited_stages
        WHERE task_id = ${taskId}
        ORDER BY started_at ASC, stage_thread_id ASC
      `,
  });

  const upsert: ProjectionAwaitedStageRepositoryShape["upsert"] = (row) =>
    upsertProjectionAwaitedStageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAwaitedStageRepository.upsert:query")),
    );

  const listByTaskId: ProjectionAwaitedStageRepositoryShape["listByTaskId"] = (input) =>
    listProjectionAwaitedStageRowsByTask(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAwaitedStageRepository.listByTaskId:query")),
    );

  return {
    upsert,
    listByTaskId,
  } satisfies ProjectionAwaitedStageRepositoryShape;
});

export const ProjectionAwaitedStageRepositoryLive = Layer.effect(
  ProjectionAwaitedStageRepository,
  makeProjectionAwaitedStageRepository,
);
