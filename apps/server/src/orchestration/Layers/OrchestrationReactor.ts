import { CommandId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { superviseForever } from "@t3tools/shared/StreamSupervision";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { OrphanTurnReconciler } from "../Services/OrphanTurnReconciler.ts";
import { PmRuntime } from "../Services/PmRuntime.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { TaskWorktreeReactor } from "../Services/TaskWorktreeReactor.ts";
import { TaskCancellationReconciler } from "../Services/TaskCancellationReconciler.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { HelperRunReactor } from "../Services/HelperRunReactor.ts";
import { ProjectContextRunReactor } from "../Services/ProjectContextRunReactor.ts";
import { PullRequestSyncReactor } from "../Services/PullRequestSyncReactor.ts";
import { CapabilityPauseReactor } from "../Services/CapabilityPauseReactor.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

export function canAutomaticallyDispatchMessageQueue(input: {
  readonly hasOrchestrationOwnership: boolean;
  readonly headStatus: "queued" | "held" | "dispatching" | "failed" | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly latestTurnIsSettled: boolean;
  readonly sessionStatus:
    | "starting"
    | "running"
    | "ready"
    | "idle"
    | "error"
    | "interrupted"
    | "stopped"
    | null;
}): boolean {
  return (
    !input.hasOrchestrationOwnership &&
    input.headStatus === "queued" &&
    !input.hasPendingApprovals &&
    !input.hasPendingUserInput &&
    input.latestTurnIsSettled &&
    (input.sessionStatus === null ||
      input.sessionStatus === "ready" ||
      input.sessionStatus === "idle")
  );
}

export const startMessageQueueReactor = Effect.fn("startMessageQueueReactor")(function* (
  orchestrationEngine: OrchestrationEngineShape,
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
) {
  const attemptAutomaticQueueDispatch = Effect.fn("attemptAutomaticQueueDispatch")(function* (
    threadId: ThreadId,
  ) {
    const [detail, shell] = yield* Effect.all([
      projectionSnapshotQuery.getThreadDetailById(threadId),
      projectionSnapshotQuery.getThreadShellById(threadId),
    ]);
    if (Option.isNone(detail) || Option.isNone(shell)) return;
    const thread = detail.value;
    const threadShell = shell.value;
    const head = thread.queuedMessages?.[0];
    if (
      !canAutomaticallyDispatchMessageQueue({
        hasOrchestrationOwnership: thread.orchestrationOwnership != null,
        headStatus: head?.status ?? null,
        hasPendingApprovals: threadShell.hasPendingApprovals,
        hasPendingUserInput: threadShell.hasPendingUserInput,
        latestTurnIsSettled:
          threadShell.latestTurn === null || threadShell.latestTurn.completedAt !== null,
        sessionStatus: threadShell.session?.status ?? null,
      })
    ) {
      return;
    }
    if (!head) return;
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* orchestrationEngine
      .dispatch({
        type: "thread.queue.auto-dispatch",
        commandId: CommandId.make(`queue-auto:${head.id}:${thread.updatedAt}`),
        threadId,
        queueItemId: head.id,
        expectedThreadUpdatedAt: thread.updatedAt,
        createdAt,
      })
      .pipe(Effect.catchTag("OrchestrationCommandInvariantError", () => Effect.void));
  });

  const recoveryState = yield* Ref.make({
    complete: false,
    pendingThreadIds: new Set<ThreadId>(),
  });
  const dispatchOrBuffer = Effect.fn("dispatchOrBufferQueuedMessage")(function* (
    threadId: ThreadId,
  ) {
    const shouldDispatch = yield* Ref.modify(recoveryState, (state) => {
      if (state.complete) return [true, state] as const;
      const pendingThreadIds = new Set(state.pendingThreadIds);
      pendingThreadIds.add(threadId);
      return [false, { complete: false, pendingThreadIds }] as const;
    });
    if (shouldDispatch) yield* attemptAutomaticQueueDispatch(threadId);
  });

  const listenerScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(listenerScope, Exit.void));
  yield* superviseForever(
    { site: "MessageQueueReactor.domainEvents", restartOnSuccess: true },
    Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
      event.aggregateKind === "thread"
        ? dispatchOrBuffer(ThreadId.make(event.aggregateId))
        : Effect.void,
    ),
  ).pipe(Effect.forkIn(listenerScope));

  const recover = Effect.gen(function* () {
    const snapshot = yield* projectionSnapshotQuery.getCommandReadModel();
    for (const thread of snapshot.threads) {
      for (const queuedMessage of thread.queuedMessages ?? []) {
        if (queuedMessage.status !== "dispatching" || queuedMessage.dispatchCommandId === null) {
          continue;
        }
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        yield* orchestrationEngine.dispatch({
          type: "thread.queue.dispatch.fail",
          commandId: CommandId.make(`${queuedMessage.dispatchCommandId}:restart-recovery-failed`),
          threadId: thread.id,
          queueItemId: queuedMessage.id,
          dispatchCommandId: queuedMessage.dispatchCommandId,
          error: "The server restarted before it could confirm provider delivery.",
          createdAt,
        });
      }
    }

    const pendingThreadIds = yield* Ref.modify(recoveryState, (state) => [
      state.pendingThreadIds,
      { complete: true, pendingThreadIds: new Set<ThreadId>() },
    ]);
    const threadIdsToCheck = new Set(snapshot.threads.map((thread) => thread.id));
    for (const threadId of pendingThreadIds) threadIdsToCheck.add(threadId);
    yield* Effect.forEach(threadIdsToCheck, attemptAutomaticQueueDispatch, {
      concurrency: 1,
      discard: true,
    });
  });

  yield* recover.pipe(
    Effect.onError(() => Scope.close(listenerScope, Exit.void).pipe(Effect.ignore)),
  );
});

export const makeOrchestrationReactor = Effect.gen(function* () {
  const taskCancellationReconciler = yield* TaskCancellationReconciler;
  const orphanTurnReconciler = yield* OrphanTurnReconciler;
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const threadDeletionReactor = yield* ThreadDeletionReactor;
  const taskWorktreeReactor = yield* TaskWorktreeReactor;
  const helperRunReactor = yield* HelperRunReactor;
  const projectContextRunReactor = yield* ProjectContextRunReactor;
  const pullRequestSyncReactor = yield* PullRequestSyncReactor;
  const capabilityPauseReactor = yield* CapabilityPauseReactor;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const pmRuntime = yield* PmRuntime;

  const start: OrchestrationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* taskCancellationReconciler.reconcile();
    yield* providerRuntimeIngestion.start();
    yield* providerCommandReactor.start();
    yield* startMessageQueueReactor(orchestrationEngine, projectionSnapshotQuery).pipe(
      Effect.orDie,
    );
    yield* checkpointReactor.start();
    yield* threadDeletionReactor.start();
    yield* taskWorktreeReactor.start();
    yield* pullRequestSyncReactor.start();
    yield* capabilityPauseReactor.start();
    yield* helperRunReactor.start();
    yield* projectContextRunReactor.start();
    // PM startup can replay a settlement and immediately hand off a retry, so
    // provider consumers must already be subscribed before the PM starts.
    yield* pmRuntime.start();
    // Emit orphan-stage settlements only after the PM subscription is live,
    // then keep reconciling on an interval so mid-run provider deaths repair
    // without waiting for a restart.
    yield* orphanTurnReconciler.start();
  });

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
