import { OrchestrationHelperRunAttachment, ProviderOptionSelections } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionHelperRunInput,
  ListProjectionHelperRunsByProjectInput,
  ListProjectionHelperRunsByTaskInput,
  ListProjectionHelperRunsByThreadInput,
  ProjectionHelperRun,
  ProjectionHelperRunRepository,
  type ProjectionHelperRunRepositoryShape,
} from "../Services/ProjectionHelperRuns.ts";

const ProjectionHelperRunDbRow = ProjectionHelperRun.mapFields(
  Struct.assign({
    attachment: Schema.fromJsonString(OrchestrationHelperRunAttachment),
    modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderOptionSelections)),
  }),
);

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const upsert = SqlSchema.void({
    Request: ProjectionHelperRun,
    execute: (run) => sql`
      INSERT INTO projection_helper_runs (
        helper_run_id, project_id, attachment_json, access_mode, tier, provider_instance_id, model,
        model_options_json, prompt, status, provider_thread_id, result, failure_message,
        created_at, started_at, completed_at, updated_at
      ) VALUES (
        ${run.id}, ${run.projectId}, ${JSON.stringify(run.attachment)}, ${run.accessMode}, ${run.tier},
        ${run.providerInstanceId}, ${run.model},
        ${run.modelOptions === null ? null : JSON.stringify(run.modelOptions)}, ${run.prompt},
        ${run.status}, ${run.providerThreadId}, ${run.result}, ${run.failureMessage},
        ${run.createdAt}, ${run.startedAt}, ${run.completedAt}, ${run.updatedAt}
      )
      ON CONFLICT (helper_run_id) DO UPDATE SET
        project_id = excluded.project_id,
        attachment_json = excluded.attachment_json,
        access_mode = excluded.access_mode,
        tier = excluded.tier,
        provider_instance_id = excluded.provider_instance_id,
        model = excluded.model,
        model_options_json = excluded.model_options_json,
        prompt = excluded.prompt,
        status = excluded.status,
        provider_thread_id = excluded.provider_thread_id,
        result = excluded.result,
        failure_message = excluded.failure_message,
        created_at = excluded.created_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `,
  });

  const select = sql`
    SELECT
      helper_run_id AS "id", project_id AS "projectId", attachment_json AS "attachment",
      access_mode AS "accessMode",
      tier, provider_instance_id AS "providerInstanceId", model,
      model_options_json AS "modelOptions", prompt, status,
      provider_thread_id AS "providerThreadId", result,
      failure_message AS "failureMessage", created_at AS "createdAt",
      started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt"
    FROM projection_helper_runs
  `;

  const getById = SqlSchema.findOneOption({
    Request: GetProjectionHelperRunInput,
    Result: ProjectionHelperRunDbRow,
    execute: ({ helperRunId }) => sql`${select} WHERE helper_run_id = ${helperRunId}`,
  });
  const listByProjectId = SqlSchema.findAll({
    Request: ListProjectionHelperRunsByProjectInput,
    Result: ProjectionHelperRunDbRow,
    execute: ({ projectId }) =>
      sql`${select} WHERE project_id = ${projectId} ORDER BY created_at ASC, helper_run_id ASC`,
  });
  const listByTaskId = SqlSchema.findAll({
    Request: ListProjectionHelperRunsByTaskInput,
    Result: ProjectionHelperRunDbRow,
    execute: ({ taskId }) =>
      sql`${select} WHERE json_extract(attachment_json, '$.kind') = 'task' AND json_extract(attachment_json, '$.taskId') = ${taskId} ORDER BY created_at ASC, helper_run_id ASC`,
  });
  const listByThreadId = SqlSchema.findAll({
    Request: ListProjectionHelperRunsByThreadInput,
    Result: ProjectionHelperRunDbRow,
    execute: ({ threadId }) =>
      sql`${select} WHERE json_extract(attachment_json, '$.kind') = 'pm' AND json_extract(attachment_json, '$.threadId') = ${threadId} ORDER BY created_at ASC, helper_run_id ASC`,
  });
  const listAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionHelperRunDbRow,
    execute: () => sql`${select} ORDER BY created_at ASC, helper_run_id ASC`,
  });

  const upsertRun: ProjectionHelperRunRepositoryShape["upsert"] = (run) =>
    upsert(run).pipe(Effect.mapError(toPersistenceSqlError("ProjectionHelperRuns.upsert")));
  const getRun: ProjectionHelperRunRepositoryShape["getById"] = (input) =>
    getById(input).pipe(Effect.mapError(toPersistenceSqlError("ProjectionHelperRuns.getById")));
  const listProjectRuns: ProjectionHelperRunRepositoryShape["listByProjectId"] = (input) =>
    listByProjectId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionHelperRuns.listByProjectId")),
    );
  const listTaskRuns: ProjectionHelperRunRepositoryShape["listByTaskId"] = (input) =>
    listByTaskId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionHelperRuns.listByTaskId")),
    );
  const listThreadRuns: ProjectionHelperRunRepositoryShape["listByThreadId"] = (input) =>
    listByThreadId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionHelperRuns.listByThreadId")),
    );
  const listAllRuns: ProjectionHelperRunRepositoryShape["listAll"] = () =>
    listAll(undefined).pipe(Effect.mapError(toPersistenceSqlError("ProjectionHelperRuns.listAll")));

  return {
    upsert: upsertRun,
    getById: getRun,
    listByProjectId: listProjectRuns,
    listByTaskId: listTaskRuns,
    listByThreadId: listThreadRuns,
    listAll: listAllRuns,
  } satisfies ProjectionHelperRunRepositoryShape;
});

export const ProjectionHelperRunRepositoryLive = Layer.effect(
  ProjectionHelperRunRepository,
  makeRepository,
);
