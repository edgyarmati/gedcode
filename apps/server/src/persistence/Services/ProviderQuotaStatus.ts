import { IsoDateTime, ProviderInstanceId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProviderQuotaProjectionStatus = Schema.Literals([
  "ok",
  "blocked-until",
  "blocked-unknown",
]);
export type ProviderQuotaProjectionStatus = typeof ProviderQuotaProjectionStatus.Type;

export const ProviderQuotaStatusRow = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  status: ProviderQuotaProjectionStatus,
  resetAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ProviderQuotaStatusRow = typeof ProviderQuotaStatusRow.Type;

export const UpsertProviderQuotaStatusInput = ProviderQuotaStatusRow;
export type UpsertProviderQuotaStatusInput = typeof UpsertProviderQuotaStatusInput.Type;

export const GetProviderQuotaStatusInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
});
export type GetProviderQuotaStatusInput = typeof GetProviderQuotaStatusInput.Type;

export const ProviderQuotaBlockState = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  status: ProviderQuotaProjectionStatus,
  blocked: Schema.Boolean,
  resetAt: Schema.NullOr(IsoDateTime),
});
export type ProviderQuotaBlockState = typeof ProviderQuotaBlockState.Type;

export const MarkProviderQuotaBlockedInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  resetAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type MarkProviderQuotaBlockedInput = typeof MarkProviderQuotaBlockedInput.Type;

export const ProviderQuotaStatusChange = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  previousStatus: Schema.NullOr(ProviderQuotaProjectionStatus),
  nextStatus: ProviderQuotaProjectionStatus,
  resetAt: Schema.NullOr(IsoDateTime),
});
export type ProviderQuotaStatusChange = typeof ProviderQuotaStatusChange.Type;

export const RuntimeQuotaStatusInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  runtimeStatus: TrimmedNonEmptyString,
  resetAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type RuntimeQuotaStatusInput = typeof RuntimeQuotaStatusInput.Type;

export const defaultOkQuotaState = (
  providerInstanceId: ProviderInstanceId,
): ProviderQuotaBlockState => ({
  providerInstanceId,
  status: "ok",
  blocked: false,
  resetAt: null,
});

export const quotaBlockStateFromRow = (row: ProviderQuotaStatusRow): ProviderQuotaBlockState => ({
  providerInstanceId: row.providerInstanceId,
  status: row.status,
  blocked: row.status !== "ok",
  resetAt: row.resetAt,
});

export interface ProviderQuotaStatusRepositoryShape {
  readonly upsert: (
    input: UpsertProviderQuotaStatusInput,
  ) => Effect.Effect<ProviderQuotaStatusChange, ProjectionRepositoryError>;

  readonly markBlocked: (
    input: MarkProviderQuotaBlockedInput,
  ) => Effect.Effect<ProviderQuotaStatusChange, ProjectionRepositoryError>;

  readonly observeRuntimeStatus: (
    input: RuntimeQuotaStatusInput,
  ) => Effect.Effect<Option.Option<ProviderQuotaStatusChange>, ProjectionRepositoryError>;

  readonly getByProviderInstanceId: (
    input: GetProviderQuotaStatusInput,
  ) => Effect.Effect<Option.Option<ProviderQuotaStatusRow>, ProjectionRepositoryError>;

  readonly isInstanceQuotaBlocked: (
    input: GetProviderQuotaStatusInput,
  ) => Effect.Effect<ProviderQuotaBlockState, ProjectionRepositoryError>;

  readonly listBlocked: () => Effect.Effect<
    ReadonlyArray<ProviderQuotaStatusRow>,
    ProjectionRepositoryError
  >;
}

export class ProviderQuotaStatusRepository extends Context.Service<
  ProviderQuotaStatusRepository,
  ProviderQuotaStatusRepositoryShape
>()("gedcode/persistence/Services/ProviderQuotaStatus/ProviderQuotaStatusRepository") {}
