import {
  CommandId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  TaskId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

function makeEvent(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  occurredAt: string;
  aggregateKind: OrchestrationEvent["aggregateKind"];
  aggregateId: string;
  commandId: string | null;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.make(input.aggregateId)
        : input.aggregateKind === "task"
          ? TaskId.make(input.aggregateId)
          : ThreadId.make(input.aggregateId),
    occurredAt: input.occurredAt,
    commandId: input.commandId === null ? null : CommandId.make(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

describe("orchestration projector", () => {
  it("applies thread.created events", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);

    const next = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: now,
          commandId: "cmd-thread-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    expect(next.snapshotSequence).toBe(1);
    expect(next.threads).toEqual([
      {
        id: "thread-1",
        projectId: "project-1",
        title: "demo",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5-codex",
        },
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
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ]);
  });

  it("replays thread.cleared as dropping prior thread messages", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "pm:project-1";
    const events: OrchestrationEvent[] = [
      makeEvent({
        sequence: 1,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-thread-create",
        payload: {
          threadId,
          projectId: "project-1",
          title: "Project PM",
          modelSelection: {
            instanceId: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: "/tmp/project",
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-message-before-clear",
        payload: {
          threadId,
          messageId: "message-before-clear",
          role: "user",
          text: "before clear",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.cleared",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-thread-clear",
        payload: {
          threadId,
          clearedAt: now,
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-message-after-clear",
        payload: {
          threadId,
          messageId: "message-after-clear",
          role: "assistant",
          text: "after clear",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ];

    let readModel = createEmptyReadModel(now);
    for (const event of events) {
      readModel = await Effect.runPromise(projectEvent(readModel, event));
    }

    expect(readModel.threads[0]?.messages.map((message) => message.id)).toEqual([
      "message-after-clear",
    ]);
    expect(readModel.threads[0]?.messages[0]?.text).toBe("after clear");
    expect(readModel.threads[0]?.lastClearedSequence).toBe(3);
  });

  it("projects pending PM handoff requested, completed, and cleared state", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "pm:project-1";
    let readModel = createEmptyReadModel(now);

    const events: OrchestrationEvent[] = [
      makeEvent({
        sequence: 1,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-thread-create",
        payload: {
          threadId,
          projectId: "project-1",
          title: "Project PM",
          modelSelection: {
            instanceId: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: "/tmp/project",
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.pm-handoff-requested",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-pm-handoff",
        payload: {
          threadId,
          mode: "summary",
          brief: "Brief",
          createdAt: now,
        },
      }),
    ];

    for (const event of events) {
      readModel = await Effect.runPromise(projectEvent(readModel, event));
    }
    expect(readModel.threads[0]?.pendingPmHandoff).toEqual({
      mode: "summary",
      brief: "Brief",
      requestedAt: now,
    });

    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 3,
          type: "thread.pm-handoff-completed",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: "cmd-pm-handoff-complete",
          payload: {
            threadId,
            mode: "summary",
            createdAt: now,
          },
        }),
      ),
    );
    expect(readModel.threads[0]?.pendingPmHandoff).toBeNull();

    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 4,
          type: "thread.pm-handoff-requested",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: "cmd-pm-handoff-2",
          payload: {
            threadId,
            mode: "transcript",
            createdAt: now,
          },
        }),
      ),
    );
    expect(readModel.threads[0]?.pendingPmHandoff?.mode).toBe("transcript");

    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 5,
          type: "thread.cleared",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: "cmd-thread-clear",
          payload: {
            threadId,
            clearedAt: now,
          },
        }),
      ),
    );
    expect(readModel.threads[0]?.pendingPmHandoff).toBeNull();
  });

  it("replays legacy pi-era PM model selections as unconfigured", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);

    const next = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "project.created",
          aggregateKind: "project",
          aggregateId: "project-legacy-pm-selection",
          occurredAt: now,
          commandId: "cmd-project-create",
          payload: {
            projectId: "project-legacy-pm-selection",
            title: "Legacy PM Selection",
            workspaceRoot: "/tmp/legacy-pm-selection",
            defaultModelSelection: {
              instanceId: "codex",
              model: "gpt-5-codex",
            },
            roleModelSelections: {},
            orchestratorConfig: {
              enabled: true,
              pmModelSelection: {
                piProvider: "openai",
                model: "gpt-5.5",
              },
              openPrAsDraft: true,
            },
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]?.orchestratorConfig).toEqual({
      enabled: true,
      pmModelSelection: null,
      openPrAsDraft: true,
    });
  });

  it("fails when event payload cannot be decoded by runtime schema", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);

    await expect(
      Effect.runPromise(
        projectEvent(
          model,
          makeEvent({
            sequence: 1,
            type: "thread.created",
            aggregateKind: "thread",
            aggregateId: "thread-1",
            occurredAt: now,
            commandId: "cmd-invalid",
            payload: {
              // missing required threadId
              projectId: "project-1",
              title: "demo",
              modelSelection: {
                provider: ProviderDriverKind.make("codex"),
                model: "gpt-5-codex",
              },
              branch: null,
              worktreePath: null,
              createdAt: now,
              updatedAt: now,
            },
          }),
        ),
      ),
    ).rejects.toBeDefined();
  });

  it("applies thread.archived and thread.unarchived events", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const later = "2026-01-01T00:00:01.000Z";
    const created = await Effect.runPromise(
      projectEvent(
        createEmptyReadModel(now),
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: now,
          commandId: "cmd-thread-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    const archived = await Effect.runPromise(
      projectEvent(
        created,
        makeEvent({
          sequence: 2,
          type: "thread.archived",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: later,
          commandId: "cmd-thread-archive",
          payload: {
            threadId: "thread-1",
            archivedAt: later,
            updatedAt: later,
          },
        }),
      ),
    );
    expect(archived.threads[0]?.archivedAt).toBe(later);

    const unarchived = await Effect.runPromise(
      projectEvent(
        archived,
        makeEvent({
          sequence: 3,
          type: "thread.unarchived",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: later,
          commandId: "cmd-thread-unarchive",
          payload: {
            threadId: "thread-1",
            updatedAt: later,
          },
        }),
      ),
    );
    expect(unarchived.threads[0]?.archivedAt).toBeNull();
  });

  it("keeps projector forward-compatible for unhandled event types", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);

    const next = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 7,
          type: "thread.turn-start-requested",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: "2026-01-01T00:00:00.000Z",
          commandId: "cmd-unhandled",
          payload: {
            threadId: "thread-1",
            messageId: "message-1",
            runtimeMode: "approval-required",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
    );

    expect(next.snapshotSequence).toBe(7);
    expect(next.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(next.threads).toEqual([]);
  });

  it("clears a task's pending gates when the task is abandoned", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const abandonedAt = "2026-01-01T00:05:00.000Z";
    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "task.created",
        aggregateKind: "task",
        aggregateId: "task-cancelled",
        occurredAt: now,
        commandId: "cmd-create-cancelled",
        payload: {
          taskId: "task-cancelled",
          projectId: "project-1",
          taskType: "feature",
          title: "Cancelled task",
          branch: null,
          worktreePath: null,
          pmMessageId: null,
          playbookVersion: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "task.created",
        aggregateKind: "task",
        aggregateId: "task-other",
        occurredAt: now,
        commandId: "cmd-create-other",
        payload: {
          taskId: "task-other",
          projectId: "project-1",
          taskType: "feature",
          title: "Other task",
          branch: null,
          worktreePath: null,
          pmMessageId: null,
          playbookVersion: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "task.gate-requested",
        aggregateKind: "task",
        aggregateId: "task-cancelled",
        occurredAt: now,
        commandId: "cmd-gate-cancelled",
        payload: {
          taskId: "task-cancelled",
          gateId: "gate-cancelled",
          gate: "plan",
          contentHash: "sha256:cancelled",
          stageThreadId: null,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 4,
        type: "task.gate-requested",
        aggregateKind: "task",
        aggregateId: "task-other",
        occurredAt: now,
        commandId: "cmd-gate-other",
        payload: {
          taskId: "task-other",
          gateId: "gate-other",
          gate: "plan",
          contentHash: "sha256:other",
          stageThreadId: null,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 5,
        type: "task.stage-started",
        aggregateKind: "task",
        aggregateId: "task-cancelled",
        occurredAt: now,
        commandId: "cmd-stage-started",
        payload: {
          taskId: "task-cancelled",
          stageThreadId: "thread-cancelled-stage",
          role: "work",
          awaitedTurnId: "turn-work",
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 6,
        type: "task.abandoned",
        aggregateKind: "task",
        aggregateId: "task-cancelled",
        occurredAt: abandonedAt,
        commandId: "cmd-abandon",
        payload: {
          taskId: "task-cancelled",
          updatedAt: abandonedAt,
        },
      }),
    ];

    let readModel = createEmptyReadModel(now);
    for (const event of events) {
      readModel = await Effect.runPromise(projectEvent(readModel, event));
    }

    expect(readModel.tasks.find((task) => task.id === "task-cancelled")?.status).toBe("abandoned");
    expect(readModel.tasks.find((task) => task.id === "task-cancelled")?.currentStageThreadId).toBe(
      null,
    );
    expect((readModel.pendingGates ?? []).map((gate) => gate.gateId)).toEqual(["gate-other"]);
  });

  it("replays cancellation progress and failure without losing completed phases", async () => {
    const createdAt = "2026-07-11T00:00:00.000Z";
    const requestedAt = "2026-07-11T00:01:00.000Z";
    const interruptedAt = "2026-07-11T00:02:00.000Z";
    const failedAt = "2026-07-11T00:03:00.000Z";
    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "task.created",
        aggregateKind: "task",
        aggregateId: "task-cancellation-replay",
        occurredAt: createdAt,
        commandId: "cmd-create-cancellation-replay",
        payload: {
          taskId: "task-cancellation-replay",
          projectId: "project-1",
          taskType: "feature",
          title: "Cancellation replay",
          branch: null,
          worktreePath: null,
          pmMessageId: null,
          playbookVersion: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "task.cancellation-requested",
        aggregateKind: "task",
        aggregateId: "task-cancellation-replay",
        occurredAt: requestedAt,
        commandId: "cmd-request-cancellation-replay",
        payload: {
          taskId: "task-cancellation-replay",
          requestedAt,
          updatedAt: requestedAt,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "task.cancellation-phase-completed",
        aggregateKind: "task",
        aggregateId: "task-cancellation-replay",
        occurredAt: interruptedAt,
        commandId: "cmd-complete-interrupt",
        payload: {
          taskId: "task-cancellation-replay",
          phase: "interrupt-turn",
          updatedAt: interruptedAt,
        },
      }),
      makeEvent({
        sequence: 4,
        type: "task.cancellation-failed",
        aggregateKind: "task",
        aggregateId: "task-cancellation-replay",
        occurredAt: failedAt,
        commandId: "cmd-fail-session-stop",
        payload: {
          taskId: "task-cancellation-replay",
          phase: "stop-session",
          message: "provider session did not stop",
          failedAt,
          updatedAt: failedAt,
        },
      }),
    ];

    let readModel = createEmptyReadModel(createdAt);
    for (const event of events) {
      readModel = await Effect.runPromise(projectEvent(readModel, event));
    }

    expect(readModel.tasks[0]?.cancellation).toEqual({
      requestedAt,
      completedPhases: ["interrupt-turn"],
      failurePhase: "stop-session",
      failureMessage: "provider session did not stop",
      failedAt,
    });
    expect(readModel.tasks[0]?.updatedAt).toBe(failedAt);

    const abandonedAt = "2026-07-11T00:04:00.000Z";
    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 5,
          type: "task.abandoned",
          aggregateKind: "task",
          aggregateId: "task-cancellation-replay",
          occurredAt: abandonedAt,
          commandId: "cmd-abandon-cancellation-replay",
          payload: { taskId: "task-cancellation-replay", updatedAt: abandonedAt },
        }),
      ),
    );
    expect(readModel.tasks[0]?.cancellation).toEqual({
      requestedAt,
      completedPhases: ["interrupt-turn"],
      failurePhase: null,
      failureMessage: null,
      failedAt: null,
    });
  });

  it("ignores an out-of-order cancellation failure before cancellation is requested", async () => {
    const createdAt = "2026-07-11T01:00:00.000Z";
    const failedAt = "2026-07-11T01:01:00.000Z";
    let readModel = await Effect.runPromise(
      projectEvent(
        createEmptyReadModel(createdAt),
        makeEvent({
          sequence: 1,
          type: "task.created",
          aggregateKind: "task",
          aggregateId: "task-out-of-order-cancellation",
          occurredAt: createdAt,
          commandId: "cmd-create-out-of-order-cancellation",
          payload: {
            taskId: "task-out-of-order-cancellation",
            projectId: "project-1",
            taskType: "feature",
            title: "Out-of-order cancellation",
            branch: null,
            worktreePath: null,
            pmMessageId: null,
            playbookVersion: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 2,
          type: "task.cancellation-failed",
          aggregateKind: "task",
          aggregateId: "task-out-of-order-cancellation",
          occurredAt: failedAt,
          commandId: "cmd-fail-out-of-order-cancellation",
          payload: {
            taskId: "task-out-of-order-cancellation",
            phase: "interrupt-turn",
            message: "no cancellation reservation",
            failedAt,
            updatedAt: failedAt,
          },
        }),
      ),
    );

    expect(readModel.tasks[0]?.cancellation).toBeNull();
    expect(readModel.tasks[0]?.updatedAt).toBe(createdAt);
  });

  it("derives task status purely from task events", async () => {
    const createdAt = "2026-06-14T10:00:00.000Z";
    const classifiedAt = "2026-06-14T10:01:00.000Z";
    const planStartedAt = "2026-06-14T10:02:00.000Z";
    const gateRequestedAt = "2026-06-14T10:03:00.000Z";
    const gateResolvedAt = "2026-06-14T10:04:00.000Z";
    const workStartedAt = "2026-06-14T10:05:00.000Z";
    const workCompletedAt = "2026-06-14T10:06:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "task.created",
        aggregateKind: "task",
        aggregateId: "task-1",
        occurredAt: createdAt,
        commandId: "cmd-task-create",
        payload: {
          taskId: "task-1",
          projectId: "project-1",
          taskType: "feature",
          title: "Add orchestrator task projection",
          branch: "orchestrator/task-1",
          worktreePath: "/tmp/task-1",
          pmMessageId: "pm-message-1",
          playbookVersion: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "task.classified",
        aggregateKind: "task",
        aggregateId: "task-1",
        occurredAt: classifiedAt,
        commandId: "cmd-task-classify",
        payload: {
          taskId: "task-1",
          taskType: "feature",
          playbookVersion: "feature@v1",
          updatedAt: classifiedAt,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "task.stage-started",
        aggregateKind: "task",
        aggregateId: "task-1",
        occurredAt: planStartedAt,
        commandId: "cmd-plan-start",
        payload: {
          taskId: "task-1",
          role: "plan",
          stageThreadId: "thread-plan",
          awaitedTurnId: "turn-plan",
          updatedAt: planStartedAt,
        },
      }),
      makeEvent({
        sequence: 4,
        type: "task.gate-requested",
        aggregateKind: "task",
        aggregateId: "task-1",
        occurredAt: gateRequestedAt,
        commandId: "cmd-plan-gate",
        payload: {
          taskId: "task-1",
          gateId: "gate-plan",
          gate: "plan",
          contentHash: "sha256:plan",
          stageThreadId: "thread-plan",
          updatedAt: gateRequestedAt,
        },
      }),
      makeEvent({
        sequence: 5,
        type: "task.gate-resolved",
        aggregateKind: "task",
        aggregateId: "task-1",
        occurredAt: gateResolvedAt,
        commandId: "cmd-plan-approve",
        payload: {
          taskId: "task-1",
          gateId: "gate-plan",
          gate: "plan",
          approvedHash: "sha256:plan",
          decision: "approved",
          origin: "human",
          updatedAt: gateResolvedAt,
        },
      }),
      makeEvent({
        sequence: 6,
        type: "task.stage-started",
        aggregateKind: "task",
        aggregateId: "task-1",
        occurredAt: workStartedAt,
        commandId: "cmd-work-start",
        payload: {
          taskId: "task-1",
          role: "work",
          stageThreadId: "thread-work",
          awaitedTurnId: "turn-work",
          updatedAt: workStartedAt,
        },
      }),
      makeEvent({
        sequence: 7,
        type: "task.stage-completed",
        aggregateKind: "task",
        aggregateId: "task-1",
        occurredAt: workCompletedAt,
        commandId: "cmd-work-complete",
        payload: {
          taskId: "task-1",
          role: "work",
          stageThreadId: "thread-work",
          awaitedTurnId: "turn-work",
          updatedAt: workCompletedAt,
        },
      }),
    ];

    const statuses: string[] = [];
    let state = model;
    for (const event of events) {
      state = await Effect.runPromise(projectEvent(state, event));
      statuses.push(state.tasks[0]?.status ?? "missing");
    }

    expect(statuses).toEqual([
      "draft",
      "classified",
      "planning",
      "plan-review",
      "planning",
      "working",
      "review",
    ]);
    expect(state.tasks[0]).toMatchObject({
      id: "task-1",
      projectId: "project-1",
      type: "feature",
      status: "review",
      stageThreadIds: ["thread-plan", "thread-work"],
      currentStageThreadId: null,
      playbookVersion: "feature@v1",
    });
  });

  it("tolerates the optional diffComplete marker on stage completion without changing status derivation", async () => {
    const createdAt = "2026-06-19T10:00:00.000Z";
    const workStartedAt = "2026-06-19T10:05:00.000Z";
    const workCompletedAt = "2026-06-19T10:06:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "task.created",
        aggregateKind: "task",
        aggregateId: "task-diff",
        occurredAt: createdAt,
        commandId: "cmd-task-create",
        payload: {
          taskId: "task-diff",
          projectId: "project-1",
          taskType: "feature",
          title: "Stage completion with diff marker",
          branch: "orchestrator/task-diff",
          worktreePath: "/tmp/task-diff",
          pmMessageId: "pm-message-1",
          playbookVersion: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "task.stage-started",
        aggregateKind: "task",
        aggregateId: "task-diff",
        occurredAt: workStartedAt,
        commandId: "cmd-work-start",
        payload: {
          taskId: "task-diff",
          role: "work",
          stageThreadId: "thread-work",
          awaitedTurnId: "turn-work",
          updatedAt: workStartedAt,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "task.stage-completed",
        aggregateKind: "task",
        aggregateId: "task-diff",
        occurredAt: workCompletedAt,
        commandId: "cmd-work-complete",
        payload: {
          taskId: "task-diff",
          role: "work",
          stageThreadId: "thread-work",
          awaitedTurnId: "turn-work",
          diffComplete: false,
          updatedAt: workCompletedAt,
        },
      }),
    ];

    let state = model;
    for (const event of events) {
      state = await Effect.runPromise(projectEvent(state, event));
    }

    expect(state.tasks[0]).toMatchObject({
      id: "task-diff",
      status: "review",
      currentStageThreadId: null,
    });
  });

  it("settles an orphaned active stage as interrupted without creating a quota block", async () => {
    const createdAt = "2026-07-11T01:00:00.000Z";
    const startedAt = "2026-07-11T01:01:00.000Z";
    const interruptedAt = "2026-07-11T01:02:00.000Z";
    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "task.created",
        aggregateKind: "task",
        aggregateId: "task-orphaned",
        occurredAt: createdAt,
        commandId: "cmd-create-orphaned",
        payload: {
          taskId: "task-orphaned",
          projectId: "project-1",
          taskType: "feature",
          title: "Orphaned stage",
          branch: null,
          worktreePath: null,
          pmMessageId: null,
          playbookVersion: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "task.stage-started",
        aggregateKind: "task",
        aggregateId: "task-orphaned",
        occurredAt: startedAt,
        commandId: "cmd-start-orphaned",
        payload: {
          taskId: "task-orphaned",
          role: "work",
          stageThreadId: "thread-orphaned",
          awaitedTurnId: "turn-orphaned",
          providerInstanceId: "codex",
          model: "gpt-5-codex",
          updatedAt: startedAt,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "task.stage-interrupted",
        aggregateKind: "task",
        aggregateId: "task-orphaned",
        occurredAt: interruptedAt,
        commandId: "cmd-interrupt-orphaned",
        payload: {
          taskId: "task-orphaned",
          role: "work",
          stageThreadId: "thread-orphaned",
          reason: "orphaned",
          updatedAt: interruptedAt,
        },
      }),
    ];

    let state = createEmptyReadModel(createdAt);
    for (const event of events) {
      state = await Effect.runPromise(projectEvent(state, event));
    }

    expect(state.tasks[0]).toMatchObject({
      status: "blocked",
      currentStageThreadId: null,
      updatedAt: interruptedAt,
    });
    expect(state.stageHistory[ThreadId.make("thread-orphaned")]).toMatchObject({
      status: "interrupted",
      endedAt: interruptedAt,
    });
    expect(state.quotaBlockedStages).toEqual([]);
  });

  it("tracks quota-blocked stages and marks them resumed on the next stage start", async () => {
    const createdAt = "2026-06-20T10:00:00.000Z";
    const workStartedAt = "2026-06-20T10:01:00.000Z";
    const blockedAt = "2026-06-20T10:02:00.000Z";
    const resumedAt = "2026-06-20T10:03:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "task.created",
        aggregateKind: "task",
        aggregateId: "task-quota",
        occurredAt: createdAt,
        commandId: "cmd-task-create",
        payload: {
          taskId: "task-quota",
          projectId: "project-1",
          taskType: "feature",
          title: "Quota task",
          branch: "orchestrator/task-quota",
          worktreePath: "/tmp/task-quota",
          pmMessageId: "pm-message-1",
          playbookVersion: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "task.stage-started",
        aggregateKind: "task",
        aggregateId: "task-quota",
        occurredAt: workStartedAt,
        commandId: "cmd-work-start",
        payload: {
          taskId: "task-quota",
          role: "work",
          stageThreadId: "thread-work-blocked",
          awaitedTurnId: null,
          updatedAt: workStartedAt,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "task.stage-blocked",
        aggregateKind: "task",
        aggregateId: "task-quota",
        occurredAt: blockedAt,
        commandId: "cmd-work-block",
        payload: {
          taskId: "task-quota",
          role: "work",
          stageThreadId: "thread-work-blocked",
          reason: "quota",
          providerInstanceId: "codex",
          resetAt: "2026-06-20T10:15:00.000Z",
          updatedAt: blockedAt,
        },
      }),
    ];

    let state = model;
    for (const event of events) {
      state = await Effect.runPromise(projectEvent(state, event));
    }

    expect(state.tasks[0]).toMatchObject({
      id: "task-quota",
      status: "blocked-on-quota",
      currentStageThreadId: null,
      stageThreadIds: ["thread-work-blocked"],
    });
    expect(state.quotaBlockedStages).toEqual([
      {
        taskId: "task-quota",
        stageThreadId: "thread-work-blocked",
        role: "work",
        providerInstanceId: "codex",
        resetAt: "2026-06-20T10:15:00.000Z",
        status: "blocked",
        retryCount: 1,
        blockedAt,
        resumedAt: null,
      },
    ]);

    state = await Effect.runPromise(
      projectEvent(
        state,
        makeEvent({
          sequence: 4,
          type: "task.stage-started",
          aggregateKind: "task",
          aggregateId: "task-quota",
          occurredAt: resumedAt,
          commandId: "cmd-work-resume",
          payload: {
            taskId: "task-quota",
            role: "work",
            stageThreadId: "thread-work-resumed",
            awaitedTurnId: null,
            updatedAt: resumedAt,
          },
        }),
      ),
    );

    expect(state.tasks[0]).toMatchObject({
      status: "working",
      currentStageThreadId: "thread-work-resumed",
      stageThreadIds: ["thread-work-blocked", "thread-work-resumed"],
    });
    expect(state.quotaBlockedStages[0]).toMatchObject({
      stageThreadId: "thread-work-blocked",
      status: "resumed",
      resumedAt,
    });
  });

  it("tracks latest turn id from session lifecycle events", async () => {
    const createdAt = "2026-02-23T08:00:00.000Z";
    const startedAt = "2026-02-23T08:00:05.000Z";
    const settledAt = "2026-02-23T08:01:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const [afterRunning, afterReady] = await Effect.runPromise(
      Effect.flatMap(
        projectEvent(
          afterCreate,
          makeEvent({
            sequence: 2,
            type: "thread.session-set",
            aggregateKind: "thread",
            aggregateId: "thread-1",
            occurredAt: startedAt,
            commandId: "cmd-running",
            payload: {
              threadId: "thread-1",
              session: {
                threadId: "thread-1",
                status: "running",
                providerName: "codex",
                providerSessionId: "session-1",
                providerThreadId: "provider-thread-1",
                runtimeMode: "approval-required",
                activeTurnId: "turn-1",
                lastError: null,
                updatedAt: startedAt,
              },
            },
          }),
        ),
        (running) =>
          Effect.map(
            projectEvent(
              running,
              makeEvent({
                sequence: 3,
                type: "thread.session-set",
                aggregateKind: "thread",
                aggregateId: "thread-1",
                occurredAt: settledAt,
                commandId: "cmd-ready",
                payload: {
                  threadId: "thread-1",
                  session: {
                    threadId: "thread-1",
                    status: "ready",
                    providerName: "codex",
                    providerSessionId: "session-1",
                    providerThreadId: "provider-thread-1",
                    runtimeMode: "approval-required",
                    activeTurnId: null,
                    lastError: null,
                    updatedAt: settledAt,
                  },
                },
              }),
            ),
            (ready) => [running, ready] as const,
          ),
      ),
    );

    const thread = afterRunning.threads[0];
    expect(thread?.latestTurn?.turnId).toBe("turn-1");
    expect(thread?.session?.status).toBe("running");

    const settledThread = afterReady.threads[0];
    expect(settledThread?.latestTurn?.turnId).toBe("turn-1");
    expect(settledThread?.latestTurn?.state).toBe("completed");
    expect(settledThread?.latestTurn?.completedAt).toBe(settledAt);
  });

  it("updates canonical thread runtime mode from thread.runtime-mode-set", async () => {
    const createdAt = "2026-02-23T08:00:00.000Z";
    const updatedAt = "2026-02-23T08:00:05.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const afterUpdate = await Effect.runPromise(
      projectEvent(
        afterCreate,
        makeEvent({
          sequence: 2,
          type: "thread.runtime-mode-set",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: updatedAt,
          commandId: "cmd-runtime-mode-set",
          payload: {
            threadId: "thread-1",
            runtimeMode: "approval-required",
            updatedAt,
          },
        }),
      ),
    );

    expect(afterUpdate.threads[0]?.runtimeMode).toBe("approval-required");
    expect(afterUpdate.threads[0]?.updatedAt).toBe(updatedAt);
  });

  it("marks assistant messages completed with non-streaming updates", async () => {
    const createdAt = "2026-02-23T09:00:00.000Z";
    const deltaAt = "2026-02-23T09:00:01.000Z";
    const completeAt = "2026-02-23T09:00:03.500Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const afterDelta = await Effect.runPromise(
      projectEvent(
        afterCreate,
        makeEvent({
          sequence: 2,
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: deltaAt,
          commandId: "cmd-delta",
          payload: {
            threadId: "thread-1",
            messageId: "assistant:msg-1",
            role: "assistant",
            text: "hello",
            turnId: "turn-1",
            streaming: true,
            createdAt: deltaAt,
            updatedAt: deltaAt,
          },
        }),
      ),
    );

    const afterComplete = await Effect.runPromise(
      projectEvent(
        afterDelta,
        makeEvent({
          sequence: 3,
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: completeAt,
          commandId: "cmd-complete",
          payload: {
            threadId: "thread-1",
            messageId: "assistant:msg-1",
            role: "assistant",
            text: "",
            turnId: "turn-1",
            streaming: false,
            createdAt: completeAt,
            updatedAt: completeAt,
          },
        }),
      ),
    );

    const message = afterComplete.threads[0]?.messages[0];
    expect(message?.id).toBe("assistant:msg-1");
    expect(message?.text).toBe("hello");
    expect(message?.streaming).toBe(false);
    expect(message?.updatedAt).toBe(completeAt);
  });

  it("prunes reverted turn messages from in-memory thread snapshot", async () => {
    const createdAt = "2026-02-23T10:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 2,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:01.000Z",
        commandId: "cmd-user-1",
        payload: {
          threadId: "thread-1",
          messageId: "user-msg-1",
          role: "user",
          text: "First edit",
          turnId: null,
          streaming: false,
          createdAt: "2026-02-23T10:00:01.000Z",
          updatedAt: "2026-02-23T10:00:01.000Z",
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:02.000Z",
        commandId: "cmd-assistant-1",
        payload: {
          threadId: "thread-1",
          messageId: "assistant-msg-1",
          role: "assistant",
          text: "Updated README to v2.\n",
          turnId: "turn-1",
          streaming: false,
          createdAt: "2026-02-23T10:00:02.000Z",
          updatedAt: "2026-02-23T10:00:02.000Z",
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:02.500Z",
        commandId: "cmd-turn-1-complete",
        payload: {
          threadId: "thread-1",
          turnId: "turn-1",
          checkpointTurnCount: 1,
          checkpointRef: "refs/t3/checkpoints/thread-1/turn/1",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-msg-1",
          completedAt: "2026-02-23T10:00:02.500Z",
        },
      }),
      makeEvent({
        sequence: 5,
        type: "thread.activity-appended",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:02.750Z",
        commandId: "cmd-activity-1",
        payload: {
          threadId: "thread-1",
          activity: {
            id: "activity-1",
            tone: "tool",
            kind: "tool.started",
            summary: "Edit file started",
            payload: { toolKind: "command" },
            turnId: "turn-1",
            createdAt: "2026-02-23T10:00:02.750Z",
          },
        },
      }),
      makeEvent({
        sequence: 6,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:03.000Z",
        commandId: "cmd-user-2",
        payload: {
          threadId: "thread-1",
          messageId: "user-msg-2",
          role: "user",
          text: "Second edit",
          turnId: null,
          streaming: false,
          createdAt: "2026-02-23T10:00:03.000Z",
          updatedAt: "2026-02-23T10:00:03.000Z",
        },
      }),
      makeEvent({
        sequence: 7,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:04.000Z",
        commandId: "cmd-assistant-2",
        payload: {
          threadId: "thread-1",
          messageId: "assistant-msg-2",
          role: "assistant",
          text: "Updated README to v3.\n",
          turnId: "turn-2",
          streaming: false,
          createdAt: "2026-02-23T10:00:04.000Z",
          updatedAt: "2026-02-23T10:00:04.000Z",
        },
      }),
      makeEvent({
        sequence: 8,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:04.500Z",
        commandId: "cmd-turn-2-complete",
        payload: {
          threadId: "thread-1",
          turnId: "turn-2",
          checkpointTurnCount: 2,
          checkpointRef: "refs/t3/checkpoints/thread-1/turn/2",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-msg-2",
          completedAt: "2026-02-23T10:00:04.500Z",
        },
      }),
      makeEvent({
        sequence: 9,
        type: "thread.activity-appended",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:04.750Z",
        commandId: "cmd-activity-2",
        payload: {
          threadId: "thread-1",
          activity: {
            id: "activity-2",
            tone: "tool",
            kind: "tool.completed",
            summary: "Edit file complete",
            payload: { toolKind: "command" },
            turnId: "turn-2",
            createdAt: "2026-02-23T10:00:04.750Z",
          },
        },
      }),
      makeEvent({
        sequence: 10,
        type: "thread.reverted",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:05.000Z",
        commandId: "cmd-revert",
        payload: {
          threadId: "thread-1",
          turnCount: 1,
        },
      }),
    ];

    const afterRevert = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterCreate),
    );

    const thread = afterRevert.threads[0];
    expect(
      thread?.messages.map((message) => ({
        role: message.role,
        text: message.text,
      })),
    ).toEqual([
      { role: "user", text: "First edit" },
      { role: "assistant", text: "Updated README to v2.\n" },
    ]);
    expect(
      thread?.activities.map((activity) => ({
        id: activity.id,
        turnId: activity.turnId,
      })),
    ).toEqual([{ id: "activity-1", turnId: "turn-1" }]);
    expect(thread?.checkpoints.map((checkpoint) => checkpoint.checkpointTurnCount)).toEqual([1]);
    expect(thread?.latestTurn?.turnId).toBe("turn-1");
  });

  it("does not fallback-retain messages tied to removed turn IDs", async () => {
    const createdAt = "2026-02-26T12:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-revert",
          occurredAt: createdAt,
          commandId: "cmd-create-revert",
          payload: {
            threadId: "thread-revert",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 2,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:01.000Z",
        commandId: "cmd-turn-1",
        payload: {
          threadId: "thread-revert",
          turnId: "turn-1",
          checkpointTurnCount: 1,
          checkpointRef: "refs/t3/checkpoints/thread-revert/turn/1",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-keep",
          completedAt: "2026-02-26T12:00:01.000Z",
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:01.100Z",
        commandId: "cmd-assistant-keep",
        payload: {
          threadId: "thread-revert",
          messageId: "assistant-keep",
          role: "assistant",
          text: "kept",
          turnId: "turn-1",
          streaming: false,
          createdAt: "2026-02-26T12:00:01.100Z",
          updatedAt: "2026-02-26T12:00:01.100Z",
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:02.000Z",
        commandId: "cmd-turn-2",
        payload: {
          threadId: "thread-revert",
          turnId: "turn-2",
          checkpointTurnCount: 2,
          checkpointRef: "refs/t3/checkpoints/thread-revert/turn/2",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-remove",
          completedAt: "2026-02-26T12:00:02.000Z",
        },
      }),
      makeEvent({
        sequence: 5,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:02.050Z",
        commandId: "cmd-user-remove",
        payload: {
          threadId: "thread-revert",
          messageId: "user-remove",
          role: "user",
          text: "removed",
          turnId: "turn-2",
          streaming: false,
          createdAt: "2026-02-26T12:00:02.050Z",
          updatedAt: "2026-02-26T12:00:02.050Z",
        },
      }),
      makeEvent({
        sequence: 6,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:02.100Z",
        commandId: "cmd-assistant-remove",
        payload: {
          threadId: "thread-revert",
          messageId: "assistant-remove",
          role: "assistant",
          text: "removed",
          turnId: "turn-2",
          streaming: false,
          createdAt: "2026-02-26T12:00:02.100Z",
          updatedAt: "2026-02-26T12:00:02.100Z",
        },
      }),
      makeEvent({
        sequence: 7,
        type: "thread.reverted",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:03.000Z",
        commandId: "cmd-revert",
        payload: {
          threadId: "thread-revert",
          turnCount: 1,
        },
      }),
    ];

    const afterRevert = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterCreate),
    );

    const thread = afterRevert.threads[0];
    expect(
      thread?.messages.map((message) => ({
        id: message.id,
        role: message.role,
        turnId: message.turnId,
      })),
    ).toEqual([{ id: "assistant-keep", role: "assistant", turnId: "turn-1" }]);
  });

  it("caps message and checkpoint retention for long-lived threads", async () => {
    const createdAt = "2026-03-01T10:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-capped",
          occurredAt: createdAt,
          commandId: "cmd-create-capped",
          payload: {
            threadId: "thread-capped",
            projectId: "project-1",
            title: "capped",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const messageEvents: ReadonlyArray<OrchestrationEvent> = Array.from(
      { length: 2_100 },
      (_, index) =>
        makeEvent({
          sequence: index + 2,
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: "thread-capped",
          occurredAt: `2026-03-01T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
          commandId: `cmd-message-${index}`,
          payload: {
            threadId: "thread-capped",
            messageId: `msg-${index}`,
            role: "assistant",
            text: `message-${index}`,
            turnId: `turn-${index}`,
            streaming: false,
            createdAt: `2026-03-01T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
            updatedAt: `2026-03-01T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
          },
        }),
    );
    const afterMessages = await messageEvents.reduce<
      Promise<ReturnType<typeof createEmptyReadModel>>
    >(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterCreate),
    );

    const checkpointEvents: ReadonlyArray<OrchestrationEvent> = Array.from(
      { length: 600 },
      (_, index) =>
        makeEvent({
          sequence: index + 2_102,
          type: "thread.turn-diff-completed",
          aggregateKind: "thread",
          aggregateId: "thread-capped",
          occurredAt: `2026-03-01T10:30:${String(index % 60).padStart(2, "0")}.000Z`,
          commandId: `cmd-checkpoint-${index}`,
          payload: {
            threadId: "thread-capped",
            turnId: `turn-${index}`,
            checkpointTurnCount: index + 1,
            checkpointRef: `refs/t3/checkpoints/thread-capped/turn/${index + 1}`,
            status: "ready",
            files: [],
            assistantMessageId: `msg-${index}`,
            completedAt: `2026-03-01T10:30:${String(index % 60).padStart(2, "0")}.000Z`,
          },
        }),
    );
    const finalState = await checkpointEvents.reduce<
      Promise<ReturnType<typeof createEmptyReadModel>>
    >(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterMessages),
    );

    const thread = finalState.threads[0];
    expect(thread?.messages).toHaveLength(2_000);
    expect(thread?.messages[0]?.id).toBe("msg-100");
    expect(thread?.messages.at(-1)?.id).toBe("msg-2099");
    expect(thread?.checkpoints).toHaveLength(500);
    expect(thread?.checkpoints[0]?.turnId).toBe("turn-100");
    expect(thread?.checkpoints.at(-1)?.turnId).toBe("turn-599");
  });

  it("records the opened PR URL on the task aggregate", async () => {
    const createdAt = "2026-06-24T10:00:00.000Z";
    const openedAt = "2026-06-24T10:05:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "task.created",
          aggregateKind: "task",
          aggregateId: "task-pr",
          occurredAt: createdAt,
          commandId: "cmd-task-create",
          payload: {
            taskId: "task-pr",
            projectId: "project-1",
            taskType: "feature",
            title: "Open a PR",
            branch: "orchestrator/task-pr",
            worktreePath: "/tmp/task-pr",
            pmMessageId: null,
            playbookVersion: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );
    const afterPrOpened = await Effect.runPromise(
      projectEvent(
        afterCreate,
        makeEvent({
          sequence: 2,
          type: "task.pr-opened",
          aggregateKind: "task",
          aggregateId: "task-pr",
          occurredAt: openedAt,
          commandId: "cmd-pr-opened",
          payload: {
            taskId: "task-pr",
            prUrl: "https://github.com/acme/repo/pull/42",
            prNumber: 42,
            updatedAt: openedAt,
          },
        }),
      ),
    );
    const afterLanded = await Effect.runPromise(
      projectEvent(
        afterCreate,
        makeEvent({
          sequence: 2,
          type: "task.landed",
          aggregateKind: "task",
          aggregateId: "task-pr",
          occurredAt: openedAt,
          commandId: "cmd-landed",
          payload: {
            taskId: "task-pr",
            updatedAt: openedAt,
          },
        }),
      ),
    );
    const afterPrOpenFailed = await Effect.runPromise(
      projectEvent(
        afterLanded,
        makeEvent({
          sequence: 3,
          type: "task.pr-open-failed",
          aggregateKind: "task",
          aggregateId: "task-pr",
          occurredAt: openedAt,
          commandId: "cmd-pr-open-failed",
          payload: {
            taskId: "task-pr",
            message: "provider unavailable",
            branchPushed: true,
            updatedAt: openedAt,
          },
        }),
      ),
    );
    const afterRetry = await Effect.runPromise(
      projectEvent(
        afterPrOpenFailed,
        makeEvent({
          sequence: 4,
          type: "task.landing-retry-requested",
          aggregateKind: "task",
          aggregateId: "task-pr",
          occurredAt: "2026-06-22T00:00:05.000Z",
          commandId: "cmd-landing-retry",
          payload: {
            taskId: "task-pr",
            updatedAt: "2026-06-22T00:00:05.000Z",
          },
        }),
      ),
    );

    expect(afterCreate.tasks[0]?.prUrl).toBeNull();
    expect(afterCreate.tasks[0]?.landing).toBeNull();
    expect(afterLanded.tasks[0]?.landing?.status).toBe("opening-pr");
    expect(afterPrOpened.tasks[0]?.prUrl).toBe("https://github.com/acme/repo/pull/42");
    expect(afterPrOpened.tasks[0]?.landing?.status).toBe("completed");
    expect(afterPrOpenFailed.tasks[0]?.landing).toMatchObject({
      status: "failed",
      failureMessage: "provider unavailable",
      branchPushed: true,
    });
    expect(afterRetry.tasks[0]?.landing).toMatchObject({
      status: "opening-pr",
      failureMessage: null,
      branchPushed: false,
    });
    expect(afterPrOpened.tasks[0]?.updatedAt).toBe(openedAt);
  });

  it("replays task archive, restore, and delete tombstones without dropping history", async () => {
    const createdAt = "2026-07-12T06:00:00.000Z";
    const archivedAt = "2026-07-12T06:01:00.000Z";
    const restoredAt = "2026-07-12T06:02:00.000Z";
    const deletedAt = "2026-07-12T06:03:00.000Z";
    let model = await Effect.runPromise(
      projectEvent(
        createEmptyReadModel(createdAt),
        makeEvent({
          sequence: 1,
          type: "task.created",
          aggregateKind: "task",
          aggregateId: "task-retention",
          occurredAt: createdAt,
          commandId: "cmd-task-retention-create",
          payload: {
            taskId: "task-retention",
            projectId: "project-1",
            taskType: "feature",
            title: "Retain history",
            branch: "orchestrator/task-retention",
            worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-retention",
            pmMessageId: null,
            playbookVersion: "feature@v1",
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );
    model = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 2,
          type: "task.archived",
          aggregateKind: "task",
          aggregateId: "task-retention",
          occurredAt: archivedAt,
          commandId: "cmd-task-retention-archive",
          payload: { taskId: "task-retention", archivedAt, updatedAt: archivedAt },
        }),
      ),
    );
    expect(model.tasks[0]?.archivedAt).toBe(archivedAt);
    expect(model.tasks).toHaveLength(1);

    model = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 3,
          type: "task.restored",
          aggregateKind: "task",
          aggregateId: "task-retention",
          occurredAt: restoredAt,
          commandId: "cmd-task-retention-restore",
          payload: {
            taskId: "task-retention",
            task: { ...model.tasks[0]!, archivedAt: null, updatedAt: restoredAt },
            updatedAt: restoredAt,
          },
        }),
      ),
    );
    expect(model.tasks[0]?.archivedAt).toBeNull();

    model = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 4,
          type: "task.deleted",
          aggregateKind: "task",
          aggregateId: "task-retention",
          occurredAt: deletedAt,
          commandId: "cmd-task-retention-delete",
          payload: { taskId: "task-retention", deletedAt, updatedAt: deletedAt },
        }),
      ),
    );
    expect(model.tasks[0]?.deletedAt).toBe(deletedAt);
    expect(model.tasks[0]?.title).toBe("Retain history");
  });
});
