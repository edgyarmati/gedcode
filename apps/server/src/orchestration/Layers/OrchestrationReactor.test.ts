import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  QueuedMessageId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { OrphanTurnReconciler } from "../Services/OrphanTurnReconciler.ts";
import { PmRuntime } from "../Services/PmRuntime.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { TaskWorktreeReactor } from "../Services/TaskWorktreeReactor.ts";
import { TaskCancellationReconciler } from "../Services/TaskCancellationReconciler.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { OrchestrationReactor } from "../Services/OrchestrationReactor.ts";
import { HelperRunReactor } from "../Services/HelperRunReactor.ts";
import { ProjectContextRunReactor } from "../Services/ProjectContextRunReactor.ts";
import { PullRequestSyncReactor } from "../Services/PullRequestSyncReactor.ts";
import { CapabilityPauseReactor } from "../Services/CapabilityPauseReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import { PersistenceSqlError } from "../../persistence/Errors.ts";
import {
  canAutomaticallyDispatchMessageQueue,
  makeOrchestrationReactor,
  startMessageQueueReactor,
} from "./OrchestrationReactor.ts";

describe("OrchestrationReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationReactor, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("requires a positively ready session before automatically draining a queued head", () => {
    const ready = {
      hasOrchestrationOwnership: false,
      headStatus: "queued" as const,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      latestTurnIsSettled: true,
      sessionStatus: "ready" as const,
    };
    expect(canAutomaticallyDispatchMessageQueue(ready)).toBe(true);
    expect(canAutomaticallyDispatchMessageQueue({ ...ready, sessionStatus: "interrupted" })).toBe(
      false,
    );
    expect(canAutomaticallyDispatchMessageQueue({ ...ready, headStatus: "held" })).toBe(false);
  });

  it("buffers live queue triggers until startup recovery is complete", async () => {
    const threadId = ThreadId.make("thread-queue-recovery-race");
    const now = "2026-08-30T12:00:00.000Z";
    const queuedMessage = {
      id: QueuedMessageId.make("queue-recovery-race"),
      messageId: MessageId.make("message-recovery-race"),
      text: "next",
      attachments: [],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
      gedWorkflowEnabled: true,
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      status: "queued" as const,
      attemptCount: 0,
      dispatchCommandId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const thread = {
      id: threadId,
      projectId: ProjectId.make("project-queue-recovery-race"),
      title: "Queue recovery race",
      modelSelection: queuedMessage.modelSelection,
      gedWorkflowEnabled: true,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      pendingPmHandoff: null,
      queuedMessages: [queuedMessage],
      messageQueueEnabled: true,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    } as OrchestrationThread;
    const shell = {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      modelSelection: thread.modelSelection,
      gedWorkflowEnabled: true,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    } as OrchestrationThreadShell;
    const trigger = {
      aggregateKind: "thread",
      aggregateId: threadId,
    } as OrchestrationEvent;
    const commands: OrchestrationCommand[] = [];
    const engine = {
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.concat(Stream.succeed(trigger), Stream.never),
      streamShellEvents: Stream.never,
    } satisfies OrchestrationEngineShape;
    const snapshot = {
      snapshotSequence: 1,
      projects: [],
      threads: [thread],
      tasks: [],
      projectContextRuns: [],
      quotaBlockedStages: [],
      stageHistory: {},
      updatedAt: now,
    } as OrchestrationReadModel;
    const query = {
      getCommandReadModel: () =>
        Effect.sleep("10 millis").pipe(
          Effect.map(() => {
            const liveDispatch = commands.find(
              (command) => command.type === "thread.queue.auto-dispatch",
            );
            if (!liveDispatch) return snapshot;
            return {
              ...snapshot,
              threads: [
                {
                  ...thread,
                  queuedMessages: [
                    {
                      ...queuedMessage,
                      status: "dispatching" as const,
                      attemptCount: 1,
                      dispatchCommandId: liveDispatch.commandId,
                    },
                  ],
                },
              ],
            } as OrchestrationReadModel;
          }),
        ),
      getThreadDetailById: () => Effect.succeed(Option.some(thread)),
      getThreadShellById: () => Effect.succeed(Option.some(shell)),
    } as unknown as ProjectionSnapshotQueryShape;
    const scope = await Effect.runPromise(Scope.make("sequential"));

    await Effect.runPromise(startMessageQueueReactor(engine, query).pipe(Scope.provide(scope)));

    expect(commands.map((command) => command.type)).toEqual(["thread.queue.auto-dispatch"]);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  it("fails queue startup closed and stops its listener when recovery cannot load", async () => {
    const listenerStarted = await Effect.runPromise(Deferred.make<void>());
    let listenerClosed = false;
    const engine = {
      dispatch: () => Effect.die("dispatch should not be called"),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.unwrap(
        Deferred.succeed(listenerStarted, void 0).pipe(
          Effect.as(Stream.never as Stream.Stream<OrchestrationEvent>),
        ),
      ).pipe(Stream.ensuring(Effect.sync(() => void (listenerClosed = true)))),
      streamShellEvents: Stream.never,
    } as OrchestrationEngineShape;
    const query = {
      getCommandReadModel: () =>
        Deferred.await(listenerStarted).pipe(
          Effect.andThen(
            new PersistenceSqlError({
              operation: "queue recovery",
              detail: "unavailable",
            }),
          ),
        ),
      getThreadDetailById: () => Effect.succeed(Option.none()),
      getThreadShellById: () => Effect.succeed(Option.none()),
    } as unknown as ProjectionSnapshotQueryShape;
    const scope = await Effect.runPromise(Scope.make("sequential"));

    const exit = await Effect.runPromiseExit(
      startMessageQueueReactor(engine, query).pipe(Scope.provide(scope)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    await vi.waitFor(() => expect(listenerClosed).toBe(true));
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  it("starts orchestration reactors after startup reconciliation", async () => {
    const started: string[] = [];
    const readModel = {
      snapshotSequence: 0,
      projects: [],
      threads: [],
      tasks: [],
      helperRuns: [],
      projectContextRuns: [],
      pendingGates: [],
      quotaBlockedStages: [],
      stageHistory: {},
      updatedAt: "2026-08-30T12:00:00.000Z",
    } as OrchestrationReadModel;

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
            start: () => {
              started.push("orphan-turn-reconciler");
              return Effect.void;
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
            retryProject: () => Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(CapabilityPauseReactor, {
            start: () => {
              started.push("capability-pause-reactor");
              return Effect.void;
            },
            reconcile: () => Effect.succeed(0),
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
        Layer.provideMerge(
          Layer.succeed(PullRequestSyncReactor, {
            start: () => Effect.sync(() => void started.push("pull-request-sync-reactor")),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(HelperRunReactor, {
            start: () => {
              started.push("helper-run-reactor");
              return Effect.void;
            },
            reconcile: Effect.void,
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectContextRunReactor, {
            start: () => Effect.sync(() => void started.push("project-context-run-reactor")),
            reconcile: Effect.void,
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.mock(OrchestrationEngineService, {
            dispatch: () => Effect.die("dispatch should not be called"),
            readEvents: () => Stream.empty,
            streamDomainEvents: Stream.never,
            streamShellEvents: Stream.never,
          }),
        ),
        Layer.provideMerge(
          Layer.mock(ProjectionSnapshotQuery, {
            getCommandReadModel: () => Effect.succeed(readModel),
            getSnapshot: () => Effect.succeed(readModel),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadShellById: () => Effect.succeed(Option.none()),
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
      "pull-request-sync-reactor",
      "capability-pause-reactor",
      "helper-run-reactor",
      "project-context-run-reactor",
      "pm-runtime",
      "orphan-turn-reconciler",
    ]);

    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
