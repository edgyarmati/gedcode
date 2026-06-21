import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  defaultOkQuotaState,
  GetProviderQuotaStatusInput,
  ProviderQuotaStatusRepository,
  ProviderQuotaStatusRow,
  quotaBlockStateFromRow,
  RuntimeQuotaStatusInput,
  UpsertProviderQuotaStatusInput,
  type ProviderQuotaProjectionStatus,
  type ProviderQuotaStatusChange,
  type ProviderQuotaStatusRepositoryShape,
} from "../Services/ProviderQuotaStatus.ts";

const statusFromRuntimeStatus = (
  runtimeStatus: RuntimeQuotaStatusInput["runtimeStatus"],
  resetAt: RuntimeQuotaStatusInput["resetAt"],
): ProviderQuotaProjectionStatus | null => {
  switch (runtimeStatus) {
    case "ok":
      return "ok";
    case "warning":
    case "exhausted":
      return resetAt === null ? "blocked-unknown" : "blocked-until";
    default:
      return null;
  }
};

const changeFromRows = (
  previous: Option.Option<ProviderQuotaStatusRow>,
  next: UpsertProviderQuotaStatusInput,
): ProviderQuotaStatusChange => ({
  providerInstanceId: next.providerInstanceId,
  previousStatus: Option.isSome(previous) ? previous.value.status : null,
  nextStatus: next.status,
  resetAt: next.resetAt,
});

const makeProviderQuotaStatusRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getQuotaStatusRow = SqlSchema.findOneOption({
    Request: GetProviderQuotaStatusInput,
    Result: ProviderQuotaStatusRow,
    execute: ({ providerInstanceId }) =>
      sql`
        SELECT
          provider_instance_id AS "providerInstanceId",
          status,
          reset_at AS "resetAt",
          updated_at AS "updatedAt"
        FROM projection_provider_quota_status
        WHERE provider_instance_id = ${providerInstanceId}
      `,
  });

  const upsertQuotaStatusRow = SqlSchema.void({
    Request: UpsertProviderQuotaStatusInput,
    execute: (row) =>
      sql`
        INSERT INTO projection_provider_quota_status (
          provider_instance_id,
          status,
          reset_at,
          updated_at
        )
        VALUES (
          ${row.providerInstanceId},
          ${row.status},
          ${row.resetAt},
          ${row.updatedAt}
        )
        ON CONFLICT (provider_instance_id)
        DO UPDATE SET
          status = excluded.status,
          reset_at = excluded.reset_at,
          updated_at = excluded.updated_at
      `,
  });

  const listBlockedQuotaStatusRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProviderQuotaStatusRow,
    execute: () =>
      sql`
        SELECT
          provider_instance_id AS "providerInstanceId",
          status,
          reset_at AS "resetAt",
          updated_at AS "updatedAt"
        FROM projection_provider_quota_status
        WHERE status != 'ok'
        ORDER BY updated_at ASC, provider_instance_id ASC
      `,
  });

  const getByProviderInstanceId: ProviderQuotaStatusRepositoryShape["getByProviderInstanceId"] = (
    input,
  ) =>
    getQuotaStatusRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProviderQuotaStatusRepository.getByProviderInstanceId:query"),
      ),
    );

  const upsert: ProviderQuotaStatusRepositoryShape["upsert"] = (input) =>
    Effect.gen(function* () {
      const previous = yield* getByProviderInstanceId({
        providerInstanceId: input.providerInstanceId,
      });
      yield* upsertQuotaStatusRow(input).pipe(
        Effect.mapError(toPersistenceSqlError("ProviderQuotaStatusRepository.upsert:query")),
      );
      return changeFromRows(previous, input);
    });

  const markBlocked: ProviderQuotaStatusRepositoryShape["markBlocked"] = (input) =>
    upsert({
      providerInstanceId: input.providerInstanceId,
      status: input.resetAt === null ? "blocked-unknown" : "blocked-until",
      resetAt: input.resetAt,
      updatedAt: input.updatedAt,
    });

  const observeRuntimeStatus: ProviderQuotaStatusRepositoryShape["observeRuntimeStatus"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const status = statusFromRuntimeStatus(input.runtimeStatus, input.resetAt);
      if (status === null) {
        return Option.none<ProviderQuotaStatusChange>();
      }
      const change = yield* upsert({
        providerInstanceId: input.providerInstanceId,
        status,
        resetAt: status === "ok" ? null : input.resetAt,
        updatedAt: input.updatedAt,
      });
      return Option.some(change);
    });

  const isInstanceQuotaBlocked: ProviderQuotaStatusRepositoryShape["isInstanceQuotaBlocked"] = (
    input,
  ) =>
    getByProviderInstanceId(input).pipe(
      Effect.map((row) =>
        Option.isSome(row)
          ? quotaBlockStateFromRow(row.value)
          : defaultOkQuotaState(input.providerInstanceId),
      ),
    );

  const listBlocked: ProviderQuotaStatusRepositoryShape["listBlocked"] = () =>
    listBlockedQuotaStatusRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProviderQuotaStatusRepository.listBlocked:query")),
    );

  return {
    upsert,
    markBlocked,
    observeRuntimeStatus,
    getByProviderInstanceId,
    isInstanceQuotaBlocked,
    listBlocked,
  } satisfies ProviderQuotaStatusRepositoryShape;
});

export const ProviderQuotaStatusRepositoryLive = Layer.effect(
  ProviderQuotaStatusRepository,
  makeProviderQuotaStatusRepository,
);
