import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ListProjectionQuotaBlockedStagesByProviderInput,
  ListProjectionQuotaBlockedStagesByTaskInput,
  ProjectionQuotaBlockedStage,
  ProjectionQuotaBlockedStageRepository,
  type ProjectionQuotaBlockedStageRepositoryShape,
} from "../Services/ProjectionQuotaBlockedStages.ts";

const makeProjectionQuotaBlockedStageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertBlockedStageRow = SqlSchema.void({
    Request: ProjectionQuotaBlockedStage,
    execute: (row) =>
      sql`
        INSERT INTO projection_quota_blocked_stages (
          stage_thread_id,
          task_id,
          role,
          provider_instance_id,
          reset_at,
          status,
          retry_count,
          blocked_at,
          resumed_at
        )
        VALUES (
          ${row.stageThreadId},
          ${row.taskId},
          ${row.role},
          ${row.providerInstanceId},
          ${row.resetAt},
          ${row.status},
          ${row.retryCount},
          ${row.blockedAt},
          ${row.resumedAt}
        )
        ON CONFLICT (stage_thread_id)
        DO UPDATE SET
          task_id = excluded.task_id,
          role = excluded.role,
          provider_instance_id = excluded.provider_instance_id,
          reset_at = excluded.reset_at,
          status = excluded.status,
          retry_count = excluded.retry_count,
          blocked_at = excluded.blocked_at,
          resumed_at = excluded.resumed_at
      `,
  });

  const listBlockedStageRowsByTask = SqlSchema.findAll({
    Request: ListProjectionQuotaBlockedStagesByTaskInput,
    Result: ProjectionQuotaBlockedStage,
    execute: ({ taskId }) =>
      sql`
        SELECT
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          reset_at AS "resetAt",
          status,
          retry_count AS "retryCount",
          blocked_at AS "blockedAt",
          resumed_at AS "resumedAt"
        FROM projection_quota_blocked_stages
        WHERE task_id = ${taskId}
        ORDER BY blocked_at ASC, stage_thread_id ASC
      `,
  });

  const listBlockedStageRowsByProvider = SqlSchema.findAll({
    Request: ListProjectionQuotaBlockedStagesByProviderInput,
    Result: ProjectionQuotaBlockedStage,
    execute: ({ providerInstanceId }) =>
      sql`
        SELECT
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          reset_at AS "resetAt",
          status,
          retry_count AS "retryCount",
          blocked_at AS "blockedAt",
          resumed_at AS "resumedAt"
        FROM projection_quota_blocked_stages
        WHERE provider_instance_id = ${providerInstanceId}
          AND status = 'blocked'
        ORDER BY blocked_at ASC, stage_thread_id ASC
      `,
  });

  const listBlockedStageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionQuotaBlockedStage,
    execute: () =>
      sql`
        SELECT
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          reset_at AS "resetAt",
          status,
          retry_count AS "retryCount",
          blocked_at AS "blockedAt",
          resumed_at AS "resumedAt"
        FROM projection_quota_blocked_stages
        WHERE status = 'blocked'
        ORDER BY blocked_at ASC, stage_thread_id ASC
      `,
  });

  const listAllBlockedStageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionQuotaBlockedStage,
    execute: () =>
      sql`
        SELECT
          task_id AS "taskId",
          stage_thread_id AS "stageThreadId",
          role,
          provider_instance_id AS "providerInstanceId",
          reset_at AS "resetAt",
          status,
          retry_count AS "retryCount",
          blocked_at AS "blockedAt",
          resumed_at AS "resumedAt"
        FROM projection_quota_blocked_stages
        ORDER BY blocked_at ASC, stage_thread_id ASC
      `,
  });

  const upsert: ProjectionQuotaBlockedStageRepositoryShape["upsert"] = (row) =>
    upsertBlockedStageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionQuotaBlockedStageRepository.upsert:query")),
    );

  const listByTaskId: ProjectionQuotaBlockedStageRepositoryShape["listByTaskId"] = (input) =>
    listBlockedStageRowsByTask(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionQuotaBlockedStageRepository.listByTaskId:query"),
      ),
    );

  const listBlockedByProviderInstanceId: ProjectionQuotaBlockedStageRepositoryShape["listBlockedByProviderInstanceId"] =
    (input) =>
      listBlockedStageRowsByProvider(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionQuotaBlockedStageRepository.listBlockedByProviderInstanceId:query",
          ),
        ),
      );

  const listBlocked: ProjectionQuotaBlockedStageRepositoryShape["listBlocked"] = () =>
    listBlockedStageRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionQuotaBlockedStageRepository.listBlocked:query"),
      ),
    );

  const listAll: ProjectionQuotaBlockedStageRepositoryShape["listAll"] = () =>
    listAllBlockedStageRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionQuotaBlockedStageRepository.listAll:query")),
    );

  return {
    upsert,
    listByTaskId,
    listBlockedByProviderInstanceId,
    listBlocked,
    listAll,
  } satisfies ProjectionQuotaBlockedStageRepositoryShape;
});

export const ProjectionQuotaBlockedStageRepositoryLive = Layer.effect(
  ProjectionQuotaBlockedStageRepository,
  makeProjectionQuotaBlockedStageRepository,
);
