import { ProviderOptionSelections } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionStageHistoryInput,
  ListProjectionStageHistoryByProjectInput,
  ListProjectionStageHistoryByTaskInput,
  ProjectionStageHistoryEntry,
  ProjectionStageHistoryRepository,
  type ProjectionStageHistoryRepositoryShape,
} from "../Services/ProjectionStageHistory.ts";

const ProjectionStageHistoryDbRow = ProjectionStageHistoryEntry.mapFields(
  Struct.assign({
    modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderOptionSelections)),
    networkAccess: Schema.NullOr(Schema.BooleanFromBit),
    capabilityPauseExpiresAt: Schema.NullOr(Schema.String),
  }),
);
type ProjectionStageHistoryDbRow = typeof ProjectionStageHistoryDbRow.Type;

const mapProjectionStageHistoryDbRow = (
  row: ProjectionStageHistoryDbRow,
): ProjectionStageHistoryEntry => {
  const { networkAccess, capabilityPauseExpiresAt, ...stageHistory } = row;
  return {
    ...stageHistory,
    ...(networkAccess === null ? {} : { networkAccess }),
    ...(capabilityPauseExpiresAt === null ? {} : { capabilityPauseExpiresAt }),
  };
};

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
          capability_tier,
          provider_instance_id,
          model,
          model_options_json,
          runtime_mode,
          network_access,
          capability_pause_expires_at,
          start_head,
          status,
          started_at,
          ended_at
        )
        VALUES (
          ${row.stageThreadId},
          ${row.projectId},
          ${row.taskId},
          ${row.role},
          ${row.capabilityTier},
          ${row.providerInstanceId},
          ${row.model},
          ${row.modelOptions === null ? null : JSON.stringify(row.modelOptions)},
          ${row.runtimeMode ?? null},
          ${row.networkAccess === undefined ? null : Number(row.networkAccess)},
          ${row.capabilityPauseExpiresAt ?? null},
          ${row.startHead ?? null},
          ${row.status},
          ${row.startedAt},
          ${row.endedAt}
        )
        ON CONFLICT (stage_thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          task_id = excluded.task_id,
          role = excluded.role,
          capability_tier = excluded.capability_tier,
          provider_instance_id = excluded.provider_instance_id,
          model = excluded.model,
          model_options_json = excluded.model_options_json,
          runtime_mode = excluded.runtime_mode,
          network_access = COALESCE(excluded.network_access, projection_stage_history.network_access),
          capability_pause_expires_at = excluded.capability_pause_expires_at,
          -- A later compatibility upsert (for example thread.created adding a
          -- runtime mode) must not erase the immutable stage boundary.
          start_head = COALESCE(excluded.start_head, projection_stage_history.start_head),
          status = excluded.status,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at
      `,
  });

  const getStageHistoryRow = SqlSchema.findOneOption({
    Request: GetProjectionStageHistoryInput,
    Result: ProjectionStageHistoryDbRow,
    execute: ({ stageThreadId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          capability_tier AS "capabilityTier",
          provider_instance_id AS "providerInstanceId",
          model,
          model_options_json AS "modelOptions",
          runtime_mode AS "runtimeMode",
          network_access AS "networkAccess",
          capability_pause_expires_at AS "capabilityPauseExpiresAt",
          start_head AS "startHead",
          status,
          started_at AS "startedAt",
          ended_at AS "endedAt"
        FROM projection_stage_history
        WHERE stage_thread_id = ${stageThreadId}
      `,
  });

  const listStageHistoryRowsByProject = SqlSchema.findAll({
    Request: ListProjectionStageHistoryByProjectInput,
    Result: ProjectionStageHistoryDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          capability_tier AS "capabilityTier",
          provider_instance_id AS "providerInstanceId",
          model,
          model_options_json AS "modelOptions",
          runtime_mode AS "runtimeMode",
          network_access AS "networkAccess",
          capability_pause_expires_at AS "capabilityPauseExpiresAt",
          start_head AS "startHead",
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
    Result: ProjectionStageHistoryDbRow,
    execute: ({ taskId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          capability_tier AS "capabilityTier",
          provider_instance_id AS "providerInstanceId",
          model,
          model_options_json AS "modelOptions",
          runtime_mode AS "runtimeMode",
          network_access AS "networkAccess",
          capability_pause_expires_at AS "capabilityPauseExpiresAt",
          start_head AS "startHead",
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
    Result: ProjectionStageHistoryDbRow,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          capability_tier AS "capabilityTier",
          provider_instance_id AS "providerInstanceId",
          model,
          model_options_json AS "modelOptions",
          runtime_mode AS "runtimeMode",
          network_access AS "networkAccess",
          capability_pause_expires_at AS "capabilityPauseExpiresAt",
          start_head AS "startHead",
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
      Effect.map(Option.map(mapProjectionStageHistoryDbRow)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionStageHistoryRepository.getByStageThreadId:query"),
      ),
    );

  const listByProjectId: ProjectionStageHistoryRepositoryShape["listByProjectId"] = (input) =>
    listStageHistoryRowsByProject(input).pipe(
      Effect.map((rows) => rows.map(mapProjectionStageHistoryDbRow)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionStageHistoryRepository.listByProjectId:query"),
      ),
    );

  const listByTaskId: ProjectionStageHistoryRepositoryShape["listByTaskId"] = (input) =>
    listStageHistoryRowsByTask(input).pipe(
      Effect.map((rows) => rows.map(mapProjectionStageHistoryDbRow)),
      Effect.mapError(toPersistenceSqlError("ProjectionStageHistoryRepository.listByTaskId:query")),
    );

  const listAll: ProjectionStageHistoryRepositoryShape["listAll"] = () =>
    listAllStageHistoryRows(undefined).pipe(
      Effect.map((rows) => rows.map(mapProjectionStageHistoryDbRow)),
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
