/**
 * PmRuntime - durable PM re-entry reactor for orchestrator mode.
 *
 * Owns the catch-up + live consumption path for stage/gate settlements. The
 * concrete PI harness is hidden behind `PmProjectRuntimeFactory` so tests can
 * prove exactly-once behavior without networked LLM calls.
 *
 * @module PmRuntime
 */
import type { OrchestrationProject, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { PmRuntimeError } from "../pm/Errors.ts";

export interface PmProjectRuntime {
  readonly surfaceUserMessage: (message: string) => Effect.Effect<void, PmRuntimeError>;
  readonly createHandoffBrief: Effect.Effect<string, PmRuntimeError>;
  readonly enqueue: (message: string) => Effect.Effect<void, PmRuntimeError>;
  readonly drain: Effect.Effect<void, PmRuntimeError>;
}

export interface PmProjectRuntimeFactoryShape {
  readonly getOrCreate: (
    project: OrchestrationProject,
  ) => Effect.Effect<PmProjectRuntime, PmRuntimeError>;
  readonly waitForIdle: (projectId: ProjectId) => Effect.Effect<void, PmRuntimeError>;
  readonly invalidateRuntime: (
    projectId: ProjectId,
    reason: string,
  ) => Effect.Effect<void, PmRuntimeError>;
  readonly clearSessionStorage: (
    project: OrchestrationProject,
  ) => Effect.Effect<void, PmRuntimeError>;
  readonly resetSessionBinding: (
    project: OrchestrationProject,
  ) => Effect.Effect<void, PmRuntimeError>;
  readonly createHandoffBrief: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<string>, PmRuntimeError>;
}

export class PmProjectRuntimeFactory extends Context.Service<
  PmProjectRuntimeFactory,
  PmProjectRuntimeFactoryShape
>()("gedcode/orchestration/Services/PmRuntime/PmProjectRuntimeFactory") {}

export interface PmRuntimeShape {
  /**
   * Start historical catch-up and live settlement processing.
   *
   * The returned effect must be run in a scope so live subscriptions and worker
   * fibers stop on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal event worker is empty and idle.
   */
  readonly drain: Effect.Effect<void>;
}

export class PmRuntime extends Context.Service<PmRuntime, PmRuntimeShape>()(
  "gedcode/orchestration/Services/PmRuntime",
) {}
