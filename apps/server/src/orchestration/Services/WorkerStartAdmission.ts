/**
 * WorkerStartAdmission - Host-wide admission control for orchestrator worker
 * provider starts.
 *
 * @module WorkerStartAdmission
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface WorkerStartAdmissionShape {
  readonly withWorkerStartPermit: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class WorkerStartAdmission extends Context.Service<
  WorkerStartAdmission,
  WorkerStartAdmissionShape
>()("gedcode/orchestration/Services/WorkerStartAdmission") {}
