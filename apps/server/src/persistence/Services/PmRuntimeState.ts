/**
 * PmRuntimeStateRepository - durable PM cursor and exactly-once settlement markers.
 *
 * Owns `pm_runtime_cursor` and `pm_consumed_settlements` (migration 036). The
 * runtime uses `consumeSettlementAndAdvanceCursor` as one atomic primitive:
 * check/insert the settlement marker and advance the event cursor in the same
 * transaction before prompting the PM.
 *
 * @module PmRuntimeStateRepository
 */
import {
  GateId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PmConsumedSettlementKind = Schema.Literals(["stage", "gate", "approval"]);
export type PmConsumedSettlementKind = typeof PmConsumedSettlementKind.Type;

export const PmConsumedSettlementConsumptionStatus = Schema.Literals(["pending", "acted"]);
export type PmConsumedSettlementConsumptionStatus =
  typeof PmConsumedSettlementConsumptionStatus.Type;

export const PmRuntimeCursor = Schema.Struct({
  projectId: ProjectId,
  lastConsumedSequence: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type PmRuntimeCursor = typeof PmRuntimeCursor.Type;

export const PmConsumedSettlement = Schema.Struct({
  projectId: ProjectId,
  kind: PmConsumedSettlementKind,
  settlementKey: TrimmedNonEmptyString,
  consumedAt: IsoDateTime,
  status: PmConsumedSettlementConsumptionStatus,
});
export type PmConsumedSettlement = typeof PmConsumedSettlement.Type;

export const GetPmRuntimeCursorInput = Schema.Struct({
  projectId: ProjectId,
});
export type GetPmRuntimeCursorInput = typeof GetPmRuntimeCursorInput.Type;

export const ListPmConsumedSettlementsInput = Schema.Struct({
  projectId: ProjectId,
  kind: PmConsumedSettlementKind,
});
export type ListPmConsumedSettlementsInput = typeof ListPmConsumedSettlementsInput.Type;

export const ConsumePmSettlementInput = Schema.Struct({
  projectId: ProjectId,
  kind: PmConsumedSettlementKind,
  settlementKey: TrimmedNonEmptyString,
  sequence: NonNegativeInt,
  consumedAt: IsoDateTime,
});
export type ConsumePmSettlementInput = typeof ConsumePmSettlementInput.Type;

export const MarkPmSettlementActedInput = Schema.Struct({
  projectId: ProjectId,
  kind: PmConsumedSettlementKind,
  settlementKey: TrimmedNonEmptyString,
  actedAt: IsoDateTime,
});
export type MarkPmSettlementActedInput = typeof MarkPmSettlementActedInput.Type;

export const ListPendingPmSettlementsInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListPendingPmSettlementsInput = typeof ListPendingPmSettlementsInput.Type;

export const makeStageSettlementKey = (input: {
  readonly stageThreadId: ThreadId;
  readonly awaitedTurnId: TurnId | null;
}): string => `${input.stageThreadId}::${input.awaitedTurnId ?? "no-turn"}`;

export const makeGateSettlementKey = (gateId: GateId): string => gateId;

export interface PmRuntimeStateRepositoryShape {
  readonly getCursor: (
    input: GetPmRuntimeCursorInput,
  ) => Effect.Effect<Option.Option<PmRuntimeCursor>, ProjectionRepositoryError>;

  readonly listConsumedSettlements: (
    input: ListPmConsumedSettlementsInput,
  ) => Effect.Effect<ReadonlyArray<PmConsumedSettlement>, ProjectionRepositoryError>;

  readonly consumeSettlementAndAdvanceCursor: (
    input: ConsumePmSettlementInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;

  readonly markActed: (
    input: MarkPmSettlementActedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listPending: (
    input: ListPendingPmSettlementsInput,
  ) => Effect.Effect<ReadonlyArray<PmConsumedSettlement>, ProjectionRepositoryError>;
}

export class PmRuntimeStateRepository extends Context.Service<
  PmRuntimeStateRepository,
  PmRuntimeStateRepositoryShape
>()("gedcode/persistence/Services/PmRuntimeState/PmRuntimeStateRepository") {}
