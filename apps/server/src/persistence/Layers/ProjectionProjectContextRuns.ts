import {
  ProjectContextRunBaselineManifest,
  ProjectContextRunChanges,
  ProjectContextRunGitState,
  ProjectContextRunScopeViolationPaths,
  ProjectContextRunWorkspaceStatusManifest,
  ProviderOptionSelections,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionProjectContextRunInput,
  ListProjectionProjectContextRunsByProjectInput,
  ProjectionProjectContextRun,
  ProjectionProjectContextRunRepository,
  type ProjectionProjectContextRunRepositoryShape,
} from "../Services/ProjectionProjectContextRuns.ts";

const ProjectionProjectContextRunDbRow = ProjectionProjectContextRun.mapFields(
  Struct.assign({
    modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderOptionSelections)),
    baselineManifest: Schema.fromJsonString(ProjectContextRunBaselineManifest),
    workspaceStatusManifest: Schema.fromJsonString(ProjectContextRunWorkspaceStatusManifest),
    gitState: Schema.fromJsonString(ProjectContextRunGitState),
    changes: Schema.fromJsonString(ProjectContextRunChanges),
    scopeViolationPaths: Schema.fromJsonString(ProjectContextRunScopeViolationPaths),
  }),
);
const mapPersistenceError = (operation: string) => toPersistenceSqlError(operation);

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const upsert = SqlSchema.void({
    Request: ProjectionProjectContextRun,
    execute: (run) => sql`
      INSERT INTO projection_project_context_runs (
        project_context_run_id, project_id, mode, tier, provider_instance_id, model,
        model_options_json, primary_checkout_path, schema_version, fingerprint, prompt,
        baseline_manifest_json, workspace_status_manifest_json, git_state_json, status, pm_start_state, provider_thread_id, result,
        failure_message,
        changes_json, scope_violation_paths_json, resolution, commit_hash, result_schema_version,
        result_fingerprint, created_at, started_at, pending_review_at, failed_at, interrupted_at,
        resolved_at, updated_at
      ) VALUES (
        ${run.id}, ${run.projectId}, ${run.mode}, ${run.tier}, ${run.providerInstanceId},
        ${run.model}, ${run.modelOptions === null ? null : JSON.stringify(run.modelOptions)},
        ${run.primaryCheckoutPath}, ${run.schemaVersion}, ${run.fingerprint}, ${run.prompt},
        ${JSON.stringify(run.baselineManifest)}, ${JSON.stringify(run.workspaceStatusManifest)}, ${JSON.stringify(run.gitState)},
        ${run.status}, ${run.pmStartState}, ${run.providerThreadId},
        ${run.result}, ${run.failureMessage}, ${JSON.stringify(run.changes)},
        ${JSON.stringify(run.scopeViolationPaths)}, ${run.resolution}, ${run.commitHash},
        ${run.resultSchemaVersion}, ${run.resultFingerprint}, ${run.createdAt}, ${run.startedAt},
        ${run.pendingReviewAt}, ${run.failedAt}, ${run.interruptedAt}, ${run.resolvedAt}, ${run.updatedAt}
      )
      ON CONFLICT (project_context_run_id) DO UPDATE SET
        project_id = excluded.project_id,
        mode = excluded.mode,
        tier = excluded.tier,
        provider_instance_id = excluded.provider_instance_id,
        model = excluded.model,
        model_options_json = excluded.model_options_json,
        primary_checkout_path = excluded.primary_checkout_path,
        schema_version = excluded.schema_version,
        fingerprint = excluded.fingerprint,
        prompt = excluded.prompt,
        baseline_manifest_json = excluded.baseline_manifest_json,
        workspace_status_manifest_json = excluded.workspace_status_manifest_json,
        git_state_json = excluded.git_state_json,
        status = excluded.status,
        pm_start_state = excluded.pm_start_state,
        provider_thread_id = excluded.provider_thread_id,
        result = excluded.result,
        failure_message = excluded.failure_message,
        changes_json = excluded.changes_json,
        scope_violation_paths_json = excluded.scope_violation_paths_json,
        resolution = excluded.resolution,
        commit_hash = excluded.commit_hash,
        result_schema_version = excluded.result_schema_version,
        result_fingerprint = excluded.result_fingerprint,
        created_at = excluded.created_at,
        started_at = excluded.started_at,
        pending_review_at = excluded.pending_review_at,
        failed_at = excluded.failed_at,
        interrupted_at = excluded.interrupted_at,
        resolved_at = excluded.resolved_at,
        updated_at = excluded.updated_at
    `,
  });

  const select = sql`
    SELECT
      project_context_run_id AS "id", project_id AS "projectId", mode, tier,
      provider_instance_id AS "providerInstanceId", model,
      model_options_json AS "modelOptions", primary_checkout_path AS "primaryCheckoutPath",
      schema_version AS "schemaVersion", fingerprint, prompt,
      baseline_manifest_json AS "baselineManifest",
      workspace_status_manifest_json AS "workspaceStatusManifest",
      git_state_json AS "gitState", status, pm_start_state AS "pmStartState",
      provider_thread_id AS "providerThreadId", result, failure_message AS "failureMessage",
      changes_json AS "changes", scope_violation_paths_json AS "scopeViolationPaths",
      resolution, commit_hash AS "commitHash", result_schema_version AS "resultSchemaVersion",
      result_fingerprint AS "resultFingerprint",
      created_at AS "createdAt", started_at AS "startedAt",
      pending_review_at AS "pendingReviewAt", failed_at AS "failedAt",
      interrupted_at AS "interruptedAt", resolved_at AS "resolvedAt", updated_at AS "updatedAt"
    FROM projection_project_context_runs
  `;

  const getById = SqlSchema.findOneOption({
    Request: GetProjectionProjectContextRunInput,
    Result: ProjectionProjectContextRunDbRow,
    execute: ({ projectContextRunId }) =>
      sql`${select} WHERE project_context_run_id = ${projectContextRunId}`,
  });
  const listByProjectId = SqlSchema.findAll({
    Request: ListProjectionProjectContextRunsByProjectInput,
    Result: ProjectionProjectContextRunDbRow,
    execute: ({ projectId }) =>
      sql`${select} WHERE project_id = ${projectId} ORDER BY updated_at ASC, project_context_run_id ASC`,
  });
  const listActiveByProjectId = SqlSchema.findAll({
    Request: ListProjectionProjectContextRunsByProjectInput,
    Result: ProjectionProjectContextRunDbRow,
    execute: ({ projectId }) =>
      sql`${select} WHERE project_id = ${projectId} AND status IN ('pending', 'running', 'pending-review') ORDER BY updated_at ASC, project_context_run_id ASC`,
  });
  const listAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectContextRunDbRow,
    execute: () => sql`${select} ORDER BY updated_at ASC, project_context_run_id ASC`,
  });

  return {
    upsert: (run) =>
      upsert(run).pipe(Effect.mapError(mapPersistenceError("ProjectionProjectContextRuns.upsert"))),
    getById: (input) =>
      getById(input).pipe(
        Effect.mapError(mapPersistenceError("ProjectionProjectContextRuns.getById")),
      ),
    listByProjectId: (input) =>
      listByProjectId(input).pipe(
        Effect.mapError(mapPersistenceError("ProjectionProjectContextRuns.listByProjectId")),
      ),
    listActiveByProjectId: (input) =>
      listActiveByProjectId(input).pipe(
        Effect.mapError(mapPersistenceError("ProjectionProjectContextRuns.listActiveByProjectId")),
      ),
    listAll: () =>
      listAll(undefined).pipe(
        Effect.mapError(mapPersistenceError("ProjectionProjectContextRuns.listAll")),
      ),
  } satisfies ProjectionProjectContextRunRepositoryShape;
});

export const ProjectionProjectContextRunRepositoryLive = Layer.effect(
  ProjectionProjectContextRunRepository,
  makeRepository,
);
