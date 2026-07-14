import {
  GedRoleModelSelections,
  OrchestrationTaskAggregateProgress,
  OrchestrationTaskCancellation,
  OrchestrationTaskLanding,
  ThreadId,
} from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionTaskInput,
  ListProjectionTasksByProjectInput,
  ProjectionTask,
  ProjectionTaskRepository,
  type ProjectionTaskRepositoryShape,
} from "../Services/ProjectionTasks.ts";

// `stage_thread_ids_json` is a JSON text column (SQLite has no array type); the
// DB row schema parses it into the `stageThreadIds` array on read and the
// upsert serializes it on write.
const ProjectionTaskDbRow = ProjectionTask.mapFields(
  Struct.assign({
    stageThreadIds: Schema.fromJsonString(Schema.Array(ThreadId)),
    roleModelSelections: Schema.fromJsonString(GedRoleModelSelections),
    aggregateProgress: Schema.NullOr(Schema.fromJsonString(OrchestrationTaskAggregateProgress)),
    cancellation: Schema.NullOr(Schema.fromJsonString(OrchestrationTaskCancellation)),
    landing: Schema.NullOr(Schema.fromJsonString(OrchestrationTaskLanding)),
  }),
);
type ProjectionTaskDbRow = typeof ProjectionTaskDbRow.Type;

const makeProjectionTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionTaskRow = SqlSchema.void({
    Request: ProjectionTask,
    execute: (row) =>
      sql`
        INSERT INTO projection_tasks (
          task_id,
          project_id,
          type,
          title,
          status,
          branch,
          worktree_path,
          pr_url,
          pm_message_id,
          stage_thread_ids_json,
          current_stage_thread_id,
          parent_task_id,
          child_order,
          aggregate_progress_json,
          supersedes_task_id,
          superseded_by_task_id,
          cancellation_json,
          landing_json,
          role_model_selections_json,
          playbook_version,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          ${row.taskId},
          ${row.projectId},
          ${row.type},
          ${row.title},
          ${row.status},
          ${row.branch},
          ${row.worktreePath},
          ${row.prUrl},
          ${row.pmMessageId},
          ${JSON.stringify(row.stageThreadIds)},
          ${row.currentStageThreadId},
          ${row.parentTaskId},
          ${row.childOrder},
          ${row.aggregateProgress === null ? null : JSON.stringify(row.aggregateProgress)},
          ${row.supersedesTaskId},
          ${row.supersededByTaskId},
          ${row.cancellation === null ? null : JSON.stringify(row.cancellation)},
          ${row.landing === null ? null : JSON.stringify(row.landing)},
          ${JSON.stringify(row.roleModelSelections)},
          ${row.playbookVersion},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (task_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          type = excluded.type,
          title = excluded.title,
          status = excluded.status,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          pr_url = excluded.pr_url,
          pm_message_id = excluded.pm_message_id,
          stage_thread_ids_json = excluded.stage_thread_ids_json,
          current_stage_thread_id = excluded.current_stage_thread_id,
          parent_task_id = excluded.parent_task_id,
          child_order = excluded.child_order,
          aggregate_progress_json = excluded.aggregate_progress_json,
          supersedes_task_id = excluded.supersedes_task_id,
          superseded_by_task_id = excluded.superseded_by_task_id,
          cancellation_json = excluded.cancellation_json,
          landing_json = excluded.landing_json,
          role_model_selections_json = excluded.role_model_selections_json,
          playbook_version = excluded.playbook_version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionTaskRow = SqlSchema.findOneOption({
    Request: GetProjectionTaskInput,
    Result: ProjectionTaskDbRow,
    execute: ({ taskId }) =>
      sql`
        SELECT
          task_id AS "taskId",
          project_id AS "projectId",
          type,
          title,
          status,
          branch,
          worktree_path AS "worktreePath",
          pr_url AS "prUrl",
          pm_message_id AS "pmMessageId",
          stage_thread_ids_json AS "stageThreadIds",
          current_stage_thread_id AS "currentStageThreadId",
          parent_task_id AS "parentTaskId",
          child_order AS "childOrder",
          aggregate_progress_json AS "aggregateProgress",
          supersedes_task_id AS "supersedesTaskId",
          superseded_by_task_id AS "supersededByTaskId",
          cancellation_json AS "cancellation",
          landing_json AS "landing",
          role_model_selections_json AS "roleModelSelections",
          playbook_version AS "playbookVersion",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_tasks
        WHERE task_id = ${taskId}
      `,
  });

  const listProjectionTaskRowsByProject = SqlSchema.findAll({
    Request: ListProjectionTasksByProjectInput,
    Result: ProjectionTaskDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          task_id AS "taskId",
          project_id AS "projectId",
          type,
          title,
          status,
          branch,
          worktree_path AS "worktreePath",
          pr_url AS "prUrl",
          pm_message_id AS "pmMessageId",
          stage_thread_ids_json AS "stageThreadIds",
          current_stage_thread_id AS "currentStageThreadId",
          parent_task_id AS "parentTaskId",
          child_order AS "childOrder",
          aggregate_progress_json AS "aggregateProgress",
          supersedes_task_id AS "supersedesTaskId",
          superseded_by_task_id AS "supersededByTaskId",
          cancellation_json AS "cancellation",
          landing_json AS "landing",
          role_model_selections_json AS "roleModelSelections",
          playbook_version AS "playbookVersion",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_tasks
        WHERE project_id = ${projectId}
          AND archived_at IS NULL
          AND deleted_at IS NULL
        ORDER BY created_at ASC, task_id ASC
      `,
  });

  const listAllProjectionTaskRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionTaskDbRow,
    execute: () =>
      sql`
        SELECT
          task_id AS "taskId",
          project_id AS "projectId",
          type,
          title,
          status,
          branch,
          worktree_path AS "worktreePath",
          pr_url AS "prUrl",
          pm_message_id AS "pmMessageId",
          stage_thread_ids_json AS "stageThreadIds",
          current_stage_thread_id AS "currentStageThreadId",
          parent_task_id AS "parentTaskId",
          child_order AS "childOrder",
          aggregate_progress_json AS "aggregateProgress",
          supersedes_task_id AS "supersedesTaskId",
          superseded_by_task_id AS "supersededByTaskId",
          cancellation_json AS "cancellation",
          landing_json AS "landing",
          role_model_selections_json AS "roleModelSelections",
          playbook_version AS "playbookVersion",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_tasks
        ORDER BY created_at ASC, task_id ASC
      `,
  });

  const upsert: ProjectionTaskRepositoryShape["upsert"] = (row) =>
    Effect.gen(function* () {
      yield* upsertProjectionTaskRow(row);
      const refreshAggregateProgress = (taskId: ProjectionTask["taskId"]) =>
        sql`
          UPDATE projection_tasks
          SET aggregate_progress_json = (
            SELECT json_object(
              'total', COUNT(*),
              'terminal', SUM(CASE WHEN status IN ('landed', 'abandoned') THEN 1 ELSE 0 END),
              'landed', SUM(CASE WHEN status = 'landed' THEN 1 ELSE 0 END),
              'abandoned', SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END)
            )
            FROM projection_tasks AS children
            WHERE children.parent_task_id = ${taskId}
          )
          WHERE task_id = ${taskId}
            AND EXISTS (
              SELECT 1
              FROM projection_tasks AS children
              WHERE children.parent_task_id = ${taskId}
            )
        `;
      yield* refreshAggregateProgress(row.taskId);
      if (row.parentTaskId !== null && row.parentTaskId !== row.taskId) {
        yield* refreshAggregateProgress(row.parentTaskId);
      }
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.upsert:query")));

  const getById: ProjectionTaskRepositoryShape["getById"] = (input) =>
    getProjectionTaskRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.getById:query")),
    );

  const listByProjectId: ProjectionTaskRepositoryShape["listByProjectId"] = (input) =>
    listProjectionTaskRowsByProject(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.listByProjectId:query")),
    );

  const listAll: ProjectionTaskRepositoryShape["listAll"] = () =>
    listAllProjectionTaskRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRepository.listAll:query")),
    );

  return {
    upsert,
    getById,
    listByProjectId,
    listAll,
  } satisfies ProjectionTaskRepositoryShape;
});

export const ProjectionTaskRepositoryLive = Layer.effect(
  ProjectionTaskRepository,
  makeProjectionTaskRepository,
);
