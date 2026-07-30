import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { InboxLifecycleReconciler } from "../Services/InboxLifecycleReconciler.ts";
import { makeInboxLifecycleReconciler } from "./InboxLifecycleReconciler.ts";

it("dispatches one bounded due-wake after, but never before, a persisted Inbox snooze deadline", async () => {
  const beforeDeadline = "2026-07-30T13:00:00.000Z";
  const wakeAt = "2026-07-30T13:01:00.000Z";
  const threadId = ThreadId.make("thread-scheduler-snooze");
  const dispatched: OrchestrationCommand[] = [];
  const receiptIds = new Set<string>();
  let model: OrchestrationReadModel = {
    snapshotSequence: 1,
    projects: [],
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-scheduler"),
        title: "Snoozed normal task",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
        gedWorkflowEnabled: true,
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: beforeDeadline,
        updatedAt: beforeDeadline,
        archivedAt: null,
        deletedAt: null,
        inboxLifecycle: "snoozed",
        inboxWakeAt: wakeAt,
        pendingPmHandoff: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    tasks: [],
    helperRuns: [],
    projectContextRuns: [],
    pendingGates: [],
    quotaBlockedStages: [],
    stageHistory: {},
    updatedAt: beforeDeadline,
  };

  const runtime = ManagedRuntime.make(
    Layer.effect(
      InboxLifecycleReconciler,
      makeInboxLifecycleReconciler({ reconciliationIntervalMs: 1 }),
    ).pipe(
      Layer.provideMerge(
        Layer.succeed(OrchestrationEngineService, {
          dispatch: (command: OrchestrationCommand) =>
            Effect.sync(() => {
              if (receiptIds.has(String(command.commandId))) {
                return { sequence: dispatched.length };
              }
              receiptIds.add(String(command.commandId));
              dispatched.push(command);
              if (command.type === "thread.inbox.wake-due") {
                model = {
                  ...model,
                  threads: model.threads.map((thread) =>
                    thread.id === command.threadId
                      ? { ...thread, inboxLifecycle: "active", inboxWakeAt: null }
                      : thread,
                  ),
                };
              }
              return { sequence: dispatched.length };
            }),
        } as never),
      ),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getCommandReadModel: () => Effect.succeed(model),
        } as never),
      ),
      Layer.provideMerge(TestClock.layer()),
    ),
  );

  try {
    const reconciler = await runtime.runPromise(Effect.service(InboxLifecycleReconciler));
    const scope = await runtime.runPromise(Scope.make("sequential"));
    await runtime.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(beforeDeadline))),
    );
    await runtime.runPromise(reconciler.start().pipe(Scope.provide(scope)));
    await runtime.runPromise(TestClock.adjust(Duration.millis(59_999)));
    expect(dispatched).toEqual([]);

    await runtime.runPromise(TestClock.adjust(Duration.millis(1)));
    expect(dispatched.map((command) => command.type)).toEqual(["thread.inbox.wake-due"]);
    expect(receiptIds.size).toBe(1);

    await runtime.runPromise(TestClock.adjust(Duration.millis(10)));
    expect(dispatched).toHaveLength(1);
    await runtime.runPromise(Scope.close(scope, Exit.void));
  } finally {
    await runtime.dispose();
  }
});
