import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { OrphanTurnReconciler } from "../Services/OrphanTurnReconciler.ts";
import { PmRuntime } from "../Services/PmRuntime.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { TaskWorktreeReactor } from "../Services/TaskWorktreeReactor.ts";
import { TaskCancellationReconciler } from "../Services/TaskCancellationReconciler.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { OrchestrationReactor } from "../Services/OrchestrationReactor.ts";
import { makeOrchestrationReactor } from "./OrchestrationReactor.ts";

describe("OrchestrationReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationReactor, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("starts orchestration reactors after startup reconciliation", async () => {
    const started: string[] = [];

    runtime = ManagedRuntime.make(
      Layer.effect(OrchestrationReactor, makeOrchestrationReactor).pipe(
        Layer.provideMerge(
          Layer.succeed(TaskCancellationReconciler, {
            reconcile: () => {
              started.push("task-cancellation-reconciler");
              return Effect.succeed(0);
            },
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(OrphanTurnReconciler, {
            reconcile: () => {
              started.push("orphan-turn-reconciler");
              return Effect.succeed(0);
            },
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderRuntimeIngestionService, {
            start: () => {
              started.push("provider-runtime-ingestion");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(PmRuntime, {
            start: () => {
              started.push("pm-runtime");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderCommandReactor, {
            start: () => {
              started.push("provider-command-reactor");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(CheckpointReactor, {
            start: () => {
              started.push("checkpoint-reactor");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ThreadDeletionReactor, {
            start: () => {
              started.push("thread-deletion-reactor");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(TaskWorktreeReactor, {
            start: () => {
              started.push("task-worktree-reactor");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime!.runPromise(Effect.service(OrchestrationReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

    expect(started).toEqual([
      "task-cancellation-reconciler",
      "provider-runtime-ingestion",
      "provider-command-reactor",
      "checkpoint-reactor",
      "thread-deletion-reactor",
      "task-worktree-reactor",
      "pm-runtime",
      "orphan-turn-reconciler",
    ]);

    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
