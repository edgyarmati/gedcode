/**
 * ProjectionPendingGateRepository - Projection repository for pending gates.
 *
 * Owns persistence operations for the `projection_pending_gates`
 * reconciliation source (migration 034). One row per requested-but-unresolved
 * gate: a `task.gate-requested` opens the gate (`pending`); a human/client
 * origin `task.gate-resolved` settles it (`resolved`, recording
 * decision/origin/approvedHash).
 *
 * Projector-owned and derived purely from the `task.*` event log (Plan 018
 * WP-D / WP-H durability barrier) — the PM never writes it directly.
 *
 * @module ProjectionPendingGateRepository
 */
import {
  GateId,
  IsoDateTime,
  OrchestrationGateDecision,
  OrchestrationGateKind,
  OrchestrationGateResolutionOrigin,
  TaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * Lifecycle of a pending-gate row. `pending` until a human/client resolution
 * lands; `resolved` thereafter.
 */
export const ProjectionPendingGateStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingGateStatus = typeof ProjectionPendingGateStatus.Type;

export const ProjectionPendingGate = Schema.Struct({
  gateId: GateId,
  taskId: TaskId,
  gate: OrchestrationGateKind,
  contentHash: TrimmedNonEmptyString,
  stageThreadId: Schema.NullOr(ThreadId),
  status: ProjectionPendingGateStatus,
  approvedHash: Schema.NullOr(TrimmedNonEmptyString),
  decision: Schema.NullOr(OrchestrationGateDecision),
  origin: Schema.NullOr(OrchestrationGateResolutionOrigin),
  requestedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionPendingGate = typeof ProjectionPendingGate.Type;

export const GetProjectionPendingGateInput = Schema.Struct({
  gateId: GateId,
});
export type GetProjectionPendingGateInput = typeof GetProjectionPendingGateInput.Type;

export const ListProjectionPendingGatesByTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type ListProjectionPendingGatesByTaskInput =
  typeof ListProjectionPendingGatesByTaskInput.Type;

/**
 * ProjectionPendingGateRepositoryShape - Service API for pending gates.
 */
export interface ProjectionPendingGateRepositoryShape {
  /**
   * Insert or replace a pending-gate row. Upserts by `gateId`.
   */
  readonly upsert: (row: ProjectionPendingGate) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a pending-gate row by gate id.
   */
  readonly getByGateId: (
    input: GetProjectionPendingGateInput,
  ) => Effect.Effect<Option.Option<ProjectionPendingGate>, ProjectionRepositoryError>;

  /**
   * List pending-gate rows for a task, in request order.
   */
  readonly listByTaskId: (
    input: ListProjectionPendingGatesByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionPendingGate>, ProjectionRepositoryError>;
}

/**
 * ProjectionPendingGateRepository - Service tag for pending-gate persistence.
 */
export class ProjectionPendingGateRepository extends Context.Service<
  ProjectionPendingGateRepository,
  ProjectionPendingGateRepositoryShape
>()("gedcode/persistence/Services/ProjectionPendingGates/ProjectionPendingGateRepository") {}
