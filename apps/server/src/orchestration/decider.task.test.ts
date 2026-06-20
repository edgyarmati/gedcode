import {
  CommandId,
  EventId,
  GateId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-06-14T10:00:00.000Z";
const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asGateId = (value: string): GateId => GateId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asTaskId = (value: string): TaskId => TaskId.make(value);
const asTaskTypeId = (value: string): TaskTypeId => TaskTypeId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

function makeProjectCreatedEvent(): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: asEventId("evt-project"),
    aggregateKind: "project",
    aggregateId: asProjectId("project-1"),
    type: "project.created",
    occurredAt: now,
    commandId: asCommandId("cmd-project"),
    causationEventId: null,
    correlationId: asCommandId("cmd-project"),
    metadata: {},
    payload: {
      projectId: asProjectId("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      roleModelSelections: {},
      orchestratorConfig: { enabled: true },
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  };
}

function makeTaskCreatedEvent(input?: { readonly sequence?: number }): OrchestrationEvent {
  return {
    sequence: input?.sequence ?? 2,
    eventId: asEventId(`evt-task-${input?.sequence ?? 2}`),
    aggregateKind: "task",
    aggregateId: asTaskId("task-1"),
    type: "task.created",
    occurredAt: now,
    commandId: asCommandId("cmd-task"),
    causationEventId: null,
    correlationId: asCommandId("cmd-task"),
    metadata: {},
    payload: {
      taskId: asTaskId("task-1"),
      projectId: asProjectId("project-1"),
      taskType: asTaskTypeId("feature"),
      title: "Task",
      branch: "orchestrator/task-1",
      worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
      pmMessageId: asMessageId("pm-message-1"),
      playbookVersion: "feature@v1",
      createdAt: now,
      updatedAt: now,
    },
  };
}

function taskReadModel(overrides?: Partial<NonNullable<OrchestrationReadModel["tasks"][number]>>) {
  return Effect.gen(function* () {
    const withProject = yield* projectEvent(createEmptyReadModel(now), makeProjectCreatedEvent());
    const withTask = yield* projectEvent(withProject, makeTaskCreatedEvent());
    const task = withTask.tasks[0];
    if (!task) {
      return withTask;
    }
    return {
      ...withTask,
      tasks: [
        {
          ...task,
          ...overrides,
        },
      ],
    };
  });
}

it.layer(NodeServices.layer)("task decider invariants", (it) => {
  it.effect("creates task.created without trusting a payload status", () =>
    Effect.gen(function* () {
      const readModel = yield* projectEvent(createEmptyReadModel(now), makeProjectCreatedEvent());

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.create",
          commandId: asCommandId("cmd-create-task"),
          taskId: asTaskId("task-1"),
          projectId: asProjectId("project-1"),
          taskType: asTaskTypeId("feature"),
          title: "Task",
          pmMessageId: asMessageId("pm-message-1"),
          branch: "orchestrator/task-1",
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      if (!singleEvent) {
        return;
      }
      expect(singleEvent.type).toBe("task.created");
      expect(singleEvent.payload).not.toHaveProperty("status");
      expect(singleEvent.payload).toMatchObject({
        worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
      });
    }),
  );

  it.effect("rejects task creation when active task worktrees meet the project cap", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "working" });

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.create",
            commandId: asCommandId("cmd-create-task-2"),
            taskId: asTaskId("task-2"),
            projectId: asProjectId("project-1"),
            taskType: asTaskTypeId("feature"),
            title: "Task 2",
            pmMessageId: null,
            branch: null,
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("does not count landed tasks against the task worktree cap", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "landed" });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.create",
          commandId: asCommandId("cmd-create-task-2"),
          taskId: asTaskId("task-2"),
          projectId: asProjectId("project-1"),
          taskType: asTaskTypeId("feature"),
          title: "Task 2",
          pmMessageId: null,
          branch: null,
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.created");
      expect(singleEvent?.payload).toMatchObject({
        branch: "orchestrator/task-2",
        worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-2",
      });
    }),
  );

  it.effect("starts a stage with clamped worker runtime and an existing project model", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "review", currentStageThreadId: null });

      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.start",
          commandId: asCommandId("cmd-stage-start"),
          taskId: asTaskId("task-1"),
          role: "work",
          instructions: "Implement the accepted plan.",
          createdAt: now,
        },
      });

      expect(Array.isArray(result)).toBe(true);
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "task.stage-started",
        "thread.created",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      const threadCreated = events.find((event) => event.type === "thread.created");
      const turnRequested = events.find((event) => event.type === "thread.turn-start-requested");
      expect(threadCreated?.payload).toMatchObject({
        runtimeMode: "approval-required",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
      });
      expect(turnRequested?.payload).toMatchObject({
        runtimeMode: "approval-required",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
      });
    }),
  );

  it.effect("rejects a second active stage for the same task", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({
        status: "working",
        currentStageThreadId: asThreadId("thread-active"),
      });

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.stage.start",
            commandId: asCommandId("cmd-stage-start"),
            taskId: asTaskId("task-1"),
            role: "work",
            instructions: "Try to start another worker.",
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects stage handoffs beyond the fail-closed cap", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({
        status: "review",
        currentStageThreadId: null,
        stageThreadIds: Array.from({ length: 8 }, (_, index) =>
          asThreadId(`thread-stage-${index}`),
        ),
      });

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.stage.start",
            commandId: asCommandId("cmd-stage-start"),
            taskId: asTaskId("task-1"),
            role: "work",
            instructions: "Try to exceed the cap.",
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("completes the active task stage through an internal command", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({
        status: "working",
        currentStageThreadId: asThreadId("thread-stage-work"),
        stageThreadIds: [asThreadId("thread-stage-work")],
      });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.complete",
          commandId: asCommandId("cmd-stage-complete"),
          taskId: asTaskId("task-1"),
          role: "work",
          stageThreadId: asThreadId("thread-stage-work"),
          awaitedTurnId: asTurnId("turn-work"),
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.stage-completed");
      expect(singleEvent?.payload).toMatchObject({
        taskId: asTaskId("task-1"),
        role: "work",
        stageThreadId: asThreadId("thread-stage-work"),
        awaitedTurnId: asTurnId("turn-work"),
      });
    }),
  );

  it.effect("carries the diffComplete marker through to the stage-completed event", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({
        status: "working",
        currentStageThreadId: asThreadId("thread-stage-work"),
        stageThreadIds: [asThreadId("thread-stage-work")],
      });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.complete",
          commandId: asCommandId("cmd-stage-complete-timeout"),
          taskId: asTaskId("task-1"),
          role: "work",
          stageThreadId: asThreadId("thread-stage-work"),
          awaitedTurnId: asTurnId("turn-work"),
          diffComplete: false,
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.stage-completed");
      expect(singleEvent?.payload).toMatchObject({ diffComplete: false });
    }),
  );

  it.effect("omits diffComplete on the event when the command does not set it", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({
        status: "working",
        currentStageThreadId: asThreadId("thread-stage-work"),
        stageThreadIds: [asThreadId("thread-stage-work")],
      });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.complete",
          commandId: asCommandId("cmd-stage-complete-normal"),
          taskId: asTaskId("task-1"),
          role: "work",
          stageThreadId: asThreadId("thread-stage-work"),
          awaitedTurnId: asTurnId("turn-work"),
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.stage-completed");
      expect(singleEvent?.payload).not.toHaveProperty("diffComplete");
    }),
  );

  it.effect("rejects stage completion for an inactive stage thread", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({
        status: "working",
        currentStageThreadId: asThreadId("thread-stage-active"),
        stageThreadIds: [asThreadId("thread-stage-active"), asThreadId("thread-stage-old")],
      });

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.stage.complete",
            commandId: asCommandId("cmd-stage-complete"),
            taskId: asTaskId("task-1"),
            role: "work",
            stageThreadId: asThreadId("thread-stage-old"),
            awaitedTurnId: asTurnId("turn-old"),
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects PM-origin gate resolution", () =>
    Effect.gen(function* () {
      const readModel = {
        ...(yield* taskReadModel({ status: "plan-review" })),
        pendingGates: [
          {
            gateId: asGateId("gate-1"),
            taskId: asTaskId("task-1"),
            gate: "plan" as const,
            contentHash: "sha256:plan",
            stageThreadId: null,
            status: "pending" as const,
            approvedHash: null,
            decision: null,
            origin: null,
            requestedAt: now,
            resolvedAt: null,
          },
        ],
      };

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.gate.resolve",
            commandId: asCommandId("cmd-gate-resolve"),
            taskId: asTaskId("task-1"),
            gateId: asGateId("gate-1"),
            gate: "plan",
            approvedHash: "sha256:plan",
            decision: "approved",
            origin: "pm-runtime",
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects gate resolution with a stale content hash", () =>
    Effect.gen(function* () {
      const readModel = {
        ...(yield* taskReadModel({ status: "plan-review" })),
        pendingGates: [
          {
            gateId: asGateId("gate-1"),
            taskId: asTaskId("task-1"),
            gate: "plan" as const,
            contentHash: "sha256:current",
            stageThreadId: null,
            status: "pending" as const,
            approvedHash: null,
            decision: null,
            origin: null,
            requestedAt: now,
            resolvedAt: null,
          },
        ],
      };

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.gate.resolve",
            commandId: asCommandId("cmd-gate-resolve"),
            taskId: asTaskId("task-1"),
            gateId: asGateId("gate-1"),
            gate: "plan",
            approvedHash: "sha256:old",
            decision: "approved",
            origin: "human",
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("accepts human gate resolution when the approved hash matches the pending gate", () =>
    Effect.gen(function* () {
      const readModel = {
        ...(yield* taskReadModel({ status: "plan-review" })),
        pendingGates: [
          {
            gateId: asGateId("gate-1"),
            taskId: asTaskId("task-1"),
            gate: "plan" as const,
            contentHash: "sha256:current",
            stageThreadId: null,
            status: "pending" as const,
            approvedHash: null,
            decision: null,
            origin: null,
            requestedAt: now,
            resolvedAt: null,
          },
        ],
      };

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.gate.resolve",
          commandId: asCommandId("cmd-gate-resolve"),
          taskId: asTaskId("task-1"),
          gateId: asGateId("gate-1"),
          gate: "plan",
          approvedHash: "sha256:current",
          decision: "approved",
          origin: "human",
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.gate-resolved");
      expect(singleEvent?.payload).toMatchObject({
        gateId: asGateId("gate-1"),
        approvedHash: "sha256:current",
        origin: "human",
      });
    }),
  );

  it.effect("lands a review task only after an approved land gate", () =>
    Effect.gen(function* () {
      const readModel = {
        ...(yield* taskReadModel({ status: "review" })),
        pendingGates: [
          {
            gateId: asGateId("gate-land"),
            taskId: asTaskId("task-1"),
            gate: "land" as const,
            contentHash: "sha256:land",
            stageThreadId: null,
            status: "resolved" as const,
            approvedHash: "sha256:land",
            decision: "approved" as const,
            origin: "human" as const,
            requestedAt: now,
            resolvedAt: now,
          },
        ],
      };

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.land",
          commandId: asCommandId("cmd-land"),
          taskId: asTaskId("task-1"),
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.landed");
    }),
  );

  it.effect("rejects task.land without an approved land gate", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "review" });

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.land",
            commandId: asCommandId("cmd-land"),
            taskId: asTaskId("task-1"),
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("abandons a non-terminal task", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "blocked" });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.abandon",
          commandId: asCommandId("cmd-abandon"),
          taskId: asTaskId("task-1"),
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.abandoned");
    }),
  );
});
