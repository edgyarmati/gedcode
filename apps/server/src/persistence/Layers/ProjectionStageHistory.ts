import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionStageHistoryInput,
  ListProjectionStageHistoryByProjectInput,
  ListProjectionStageHistoryByTaskInput,
  ProjectionStageHistoryEntry,
  ProjectionStageHistoryRepository,
  type ProjectionStageHistoryRepositoryShape,
} from "../Services/ProjectionStageHistory.ts";

const makeProjectionStageHistoryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertStageHistoryRow = SqlSchema.void({
    Request: ProjectionStageHistoryEntry,
    execute: (row) =>
      sql`
        INSERT INTO projection_stage_history (
          stage_thread_id,
          project_id,
          task_id,
          role,
          provider_instance_id,
          model,
          runtime_mode,
          status,
          started_at,
          ended_at
        )
        VALUES (
          ${row.stageThreadId},
          ${row.projectId},
          ${row.taskId},
          ${row.role},
          ${row.providerInstanceId},
          ${row.model},
          ${row.runtimeMode ?? null},
          ${row.status},
          ${row.startedAt},
          ${row.endedAt}
        )
        ON CONFLICT (stage_thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          task_id = excluded.task_id,
          role = excluded.role,
          provider_instance_id = excluded.provider_instance_id,
          model = excluded.model,
          runtime_mode = excluded.runtime_mode,
          status = excluded.status,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at
      `,
  });

  const getStageHistoryRow = SqlSchema.findOneOption({
    Request: GetProjectionStageHistoryInput,
    Result: ProjectionStageHistoryEntry,
    execute: ({ stageThreadId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          model,
          runtime_mode AS "runtimeMode",
          status,
          started_at AS "startedAt",
          ended_at AS "endedAt"
        FROM projection_stage_history
        WHERE stage_thread_id = ${stageThreadId}
      `,
  });

  const listStageHistoryRowsByProject = SqlSchema.findAll({
    Request: ListProjectionStageHistoryByProjectInput,
    Result: ProjectionStageHistoryEntry,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          model,
          runtime_mode AS "runtimeMode",
          status,
          started_at AS "startedAt",
          ended_at AS "endedAt"
        FROM projection_stage_history
        WHERE project_id = ${projectId}
        ORDER BY started_at ASC, stage_thread_id ASC
      `,
  });

  const listStageHistoryRowsByTask = SqlSchema.findAll({
    Request: ListProjectionStageHistoryByTaskInput,
    Result: ProjectionStageHistoryEntry,
    execute: ({ taskId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          model,
          runtime_mode AS "runtimeMode",
          status,
          started_at AS "startedAt",
          ended_at AS "endedAt"
        FROM projection_stage_history
        WHERE task_id = ${taskId}
        ORDER BY started_at ASC, stage_thread_id ASC
      `,
  });

  const listAllStageHistoryRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStageHistoryEntry,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          model,
          runtime_mode AS "runtimeMode",
          status,
          started_at AS "startedAt",
          ended_at AS "endedAt"
        FROM projection_stage_history
        ORDER BY started_at ASC, stage_thread_id ASC
      `,
  });

  const upsert: ProjectionStageHistoryRepositoryShape["upsert"] = (row) =>
    upsertStageHistoryRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionStageHistoryRepository.upsert:query")),
    );

  const getByStageThreadId: ProjectionStageHistoryRepositoryShape["getByStageThreadId"] = (input) =>
    getStageHistoryRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionStageHistoryRepository.getByStageThreadId:query"),
      ),
    );

  const listByProjectId: ProjectionStageHistoryRepositoryShape["listByProjectId"] = (input) =>
    listStageHistoryRowsByProject(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionStageHistoryRepository.listByProjectId:query"),
      ),
    );

  const listByTaskId: ProjectionStageHistoryRepositoryShape["listByTaskId"] = (input) =>
    listStageHistoryRowsByTask(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionStageHistoryRepository.listByTaskId:query")),
    );

  const listAll: ProjectionStageHistoryRepositoryShape["listAll"] = () =>
    listAllStageHistoryRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionStageHistoryRepository.listAll:query")),
    );

  return {
    upsert,
    getByStageThreadId,
    listByProjectId,
    listByTaskId,
    listAll,
  } satisfies ProjectionStageHistoryRepositoryShape;
});

export const ProjectionStageHistoryRepositoryLive = Layer.effect(
  ProjectionStageHistoryRepository,
  makeProjectionStageHistoryRepository,
);
