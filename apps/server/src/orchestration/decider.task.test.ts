import {
  CommandId,
  EventId,
  GateId,
  MessageId,
  ORCHESTRATION_STAGE_ROLES,
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

type ProjectCreatedEvent = Extract<OrchestrationEvent, { type: "project.created" }>;
type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function makeProjectCreatedEvent(input?: {
  readonly orchestratorConfig?: ProjectCreatedEvent["payload"]["orchestratorConfig"];
}): OrchestrationEvent {
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
      orchestratorConfig: input?.orchestratorConfig ?? { enabled: true },
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

function taskReadModel(
  overrides?: Partial<NonNullable<OrchestrationReadModel["tasks"][number]>>,
  input?: { readonly orchestratorConfig?: ProjectCreatedEvent["payload"]["orchestratorConfig"] },
) {
  return Effect.gen(function* () {
    const withProject = yield* projectEvent(
      createEmptyReadModel(now),
      makeProjectCreatedEvent({ orchestratorConfig: input?.orchestratorConfig }),
    );
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

const toEvents = (result: PlannedEvent | ReadonlyArray<PlannedEvent>): PlannedEvent[] =>
  Array.isArray(result) ? [...result] : [result as PlannedEvent];

function withSequence(event: PlannedEvent, sequence: number): OrchestrationEvent {
  return {
    ...event,
    sequence,
  } as OrchestrationEvent;
}

const applyEvents = Effect.fn("deciderTask.applyEvents")(function* (
  readModel: OrchestrationReadModel,
  plannedEvents: ReadonlyArray<PlannedEvent>,
) {
  let nextModel = readModel;
  let nextSequence = readModel.snapshotSequence;

  for (const plannedEvent of plannedEvents) {
    nextSequence += 1;
    nextModel = yield* projectEvent(nextModel, withSequence(plannedEvent, nextSequence));
  }

  return nextModel;
});

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

  it.effect("inherits global maxParallelTasks when the project limit is omitted", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "working" });

      const result = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: {
          maxParallelTasks: 2,
        },
        command: {
          type: "task.create",
          commandId: asCommandId("cmd-create-task-global-cap"),
          taskId: asTaskId("task-2"),
          projectId: asProjectId("project-1"),
          taskType: asTaskTypeId("feature"),
          title: "Task 2",
          pmMessageId: null,
          branch: null,
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(result) ? result[0] : result;
      expect(singleEvent?.type).toBe("task.created");
    }),
  );

  it.effect("uses explicitly-set project maxParallelTasks over global maxParallelTasks", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        { status: "working" },
        {
          orchestratorConfig: {
            enabled: true,
            resourceLimits: {
              maxParallelTasks: 1,
            },
          },
        },
      );

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          orchestratorDefaults: {
            maxParallelTasks: 2,
          },
          command: {
            type: "task.create",
            commandId: asCommandId("cmd-create-task-project-cap"),
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

  it.effect("updates per-task role model selections from human/client origins", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel();

      for (const origin of ["human", "client"] as const) {
        const event = yield* decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.role-selections.set",
            commandId: asCommandId(`cmd-role-selections-${origin}`),
            taskId: asTaskId("task-1"),
            roleModelSelections: {
              verify: {
                instanceId: ProviderInstanceId.make("codex_verify"),
                model: "gpt-5-verify",
              },
            },
            origin,
            createdAt: now,
          },
        });

        const singleEvent = Array.isArray(event) ? event[0] : event;
        expect(singleEvent?.type).toBe("task.role-selections-updated");
        expect(singleEvent?.payload).toMatchObject({
          taskId: asTaskId("task-1"),
          origin,
          roleModelSelections: {
            verify: {
              instanceId: ProviderInstanceId.make("codex_verify"),
              model: "gpt-5-verify",
            },
          },
        });
      }
    }),
  );

  it.effect("updates per-task role model selections from PM/runtime origins", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel();

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.role-selections.set",
          commandId: asCommandId("cmd-role-selections-pm"),
          taskId: asTaskId("task-1"),
          roleModelSelections: {
            work: {
              instanceId: ProviderInstanceId.make("codex_work"),
              model: "gpt-5-work",
            },
          },
          origin: "pm-runtime",
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.role-selections-updated");
      expect(singleEvent?.payload).toMatchObject({
        taskId: asTaskId("task-1"),
        origin: "pm-runtime",
        roleModelSelections: {
          work: {
            instanceId: ProviderInstanceId.make("codex_work"),
            model: "gpt-5-work",
          },
        },
      });
    }),
  );

  it.effect("starts a stage with approval-required worker runtime by default", () =>
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

  it.effect("starts a stage with full-access runtime when the project opts in", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        { status: "review", currentStageThreadId: null },
        {
          orchestratorConfig: {
            enabled: true,
            resourceLimits: { allowFullAccessWorkers: true },
          },
        },
      );

      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.start",
          commandId: asCommandId("cmd-stage-start-full-access-project"),
          taskId: asTaskId("task-1"),
          role: "work",
          instructions: "Implement the accepted plan.",
          createdAt: now,
        },
      });

      const events = toEvents(result);
      const threadCreated = events.find((event) => event.type === "thread.created");
      const turnRequested = events.find((event) => event.type === "thread.turn-start-requested");
      expect(threadCreated?.payload).toMatchObject({
        runtimeMode: "full-access",
      });
      expect(turnRequested?.payload).toMatchObject({
        runtimeMode: "full-access",
      });
    }),
  );

  it.effect("starts a stage with full-access runtime when the global default opts in", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "review", currentStageThreadId: null });

      const result = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: { allowFullAccessWorkers: true },
        command: {
          type: "task.stage.start",
          commandId: asCommandId("cmd-stage-start-full-access-global"),
          taskId: asTaskId("task-1"),
          role: "work",
          instructions: "Implement the accepted plan.",
          createdAt: now,
        },
      });

      const events = toEvents(result);
      const threadCreated = events.find((event) => event.type === "thread.created");
      const turnRequested = events.find((event) => event.type === "thread.turn-start-requested");
      expect(threadCreated?.payload).toMatchObject({
        runtimeMode: "full-access",
      });
      expect(turnRequested?.payload).toMatchObject({
        runtimeMode: "full-access",
      });
    }),
  );

  it.effect("keeps approval-required runtime when the project disables a global opt-in", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        { status: "review", currentStageThreadId: null },
        {
          orchestratorConfig: {
            enabled: true,
            resourceLimits: { allowFullAccessWorkers: false },
          },
        },
      );

      const result = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: { allowFullAccessWorkers: true },
        command: {
          type: "task.stage.start",
          commandId: asCommandId("cmd-stage-start-full-access-project-false"),
          taskId: asTaskId("task-1"),
          role: "work",
          instructions: "Implement the accepted plan.",
          createdAt: now,
        },
      });

      const events = toEvents(result);
      const threadCreated = events.find((event) => event.type === "thread.created");
      const turnRequested = events.find((event) => event.type === "thread.turn-start-requested");
      expect(threadCreated?.payload).toMatchObject({
        runtimeMode: "approval-required",
      });
      expect(turnRequested?.payload).toMatchObject({
        runtimeMode: "approval-required",
      });
    }),
  );

  it.effect("rejects a stage role omitted from the task type stages", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        { status: "review", currentStageThreadId: null },
        {
          orchestratorConfig: {
            enabled: true,
            taskTypes: [
              {
                id: "feature",
                stages: ["classify", "plan", "work", "verify"],
              },
            ],
          },
        },
      );

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.stage.start",
            commandId: asCommandId("cmd-stage-start-disabled-review"),
            taskId: asTaskId("task-1"),
            role: "review",
            instructions: "Review the accepted plan.",
            createdAt: now,
          },
        }),
      );

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toBe("Stage role 'review' is not enabled for task type 'feature'.");
      }
    }),
  );

  it.effect("inherits global stages when project stages are omitted", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "review", currentStageThreadId: null });

      const rejected = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          orchestratorDefaults: {
            stages: ["classify", "plan", "work", "verify"],
          },
          command: {
            type: "task.stage.start",
            commandId: asCommandId("cmd-stage-start-global-reject-review"),
            taskId: asTaskId("task-1"),
            role: "review",
            instructions: "Review the accepted plan.",
            createdAt: now,
          },
        }),
      );
      expect(rejected._tag).toBe("Failure");

      const accepted = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: {
          stages: ["classify", "plan", "review", "work", "verify"],
        },
        command: {
          type: "task.stage.start",
          commandId: asCommandId("cmd-stage-start-global-allow-review"),
          taskId: asTaskId("task-1"),
          role: "review",
          instructions: "Review the accepted plan.",
          createdAt: now,
        },
      });

      expect(toEvents(accepted).map((event) => event.type)).toContain("task.stage-started");
    }),
  );

  it.effect("uses explicitly-set project stages over global stages", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        { status: "review", currentStageThreadId: null },
        {
          orchestratorConfig: {
            enabled: true,
            taskTypes: [
              {
                id: "feature",
                stages: ["classify", "plan", "work", "verify"],
              },
            ],
          },
        },
      );

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          orchestratorDefaults: {
            stages: ["classify", "plan", "review", "work", "verify"],
          },
          command: {
            type: "task.stage.start",
            commandId: asCommandId("cmd-stage-start-project-reject-review"),
            taskId: asTaskId("task-1"),
            role: "review",
            instructions: "Review the accepted plan.",
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("allows every canonical stage role for the default task type", () =>
    Effect.gen(function* () {
      for (const role of ORCHESTRATION_STAGE_ROLES) {
        const readModel = yield* taskReadModel({ status: "review", currentStageThreadId: null });

        const result = yield* decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.stage.start",
            commandId: asCommandId(`cmd-stage-start-default-${role}`),
            taskId: asTaskId("task-1"),
            role,
            instructions: `Start the ${role} stage.`,
            createdAt: now,
          },
        });

        const events = toEvents(result);
        const stageStarted = events.find((event) => event.type === "task.stage-started");
        expect(stageStarted?.type).toBe("task.stage-started");
        expect(stageStarted?.payload).toMatchObject({
          role,
          providerInstanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        });
      }
    }),
  );

  it.effect("starts a stage with task-level model precedence and one prepared role prefix", () =>
    Effect.gen(function* () {
      const baseReadModel = yield* taskReadModel({
        status: "review",
        currentStageThreadId: null,
        roleModelSelections: {
          work: {
            instanceId: ProviderInstanceId.make("codex_task"),
            model: "gpt-5-task",
          },
        },
      });
      const readModel: OrchestrationReadModel = {
        ...baseReadModel,
        projects: baseReadModel.projects.map((project) =>
          Object.assign({}, project, {
            roleModelSelections: {
              work: {
                instanceId: ProviderInstanceId.make("codex_project"),
                model: "gpt-5-project",
              },
            },
            rolePromptPrefixes: {
              work: "Use the project implementation playbook.",
            },
          }),
        ),
      };

      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.start",
          commandId: asCommandId("cmd-stage-start-override"),
          taskId: asTaskId("task-1"),
          role: "work",
          instructions: "Implement the accepted plan.",
          createdAt: now,
        },
      });

      const events = Array.isArray(result) ? result : [result];
      const threadCreated = events.find((event) => event.type === "thread.created");
      const stageStarted = events.find((event) => event.type === "task.stage-started");
      const userMessage = events.find((event) => event.type === "thread.message-sent");
      expect(threadCreated?.payload.modelSelection).toEqual({
        instanceId: ProviderInstanceId.make("codex_task"),
        model: "gpt-5-task",
      });
      // The resolved backend/model is stamped on the stage-started event so the
      // stage-history projection and the web timeline never re-resolve config.
      expect(stageStarted?.payload.providerInstanceId).toEqual(
        ProviderInstanceId.make("codex_task"),
      );
      expect(stageStarted?.payload.model).toBe("gpt-5-task");
      expect(userMessage?.payload.text).toContain("Role: work");
      expect(userMessage?.payload.text).toContain("Use the project implementation playbook.");
      expect(userMessage?.payload.text).toContain("Implement the accepted plan.");
      expect(userMessage?.payload.text.match(/BEGIN GEDCODE STAGE PROMPT PREFIX/g)).toHaveLength(1);
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

  it.effect("blocks the active task stage through an internal quota command", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({
        status: "working",
        currentStageThreadId: asThreadId("thread-stage-work"),
        stageThreadIds: [asThreadId("thread-stage-work")],
      });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.block",
          commandId: asCommandId("cmd-stage-block"),
          taskId: asTaskId("task-1"),
          role: "work",
          stageThreadId: asThreadId("thread-stage-work"),
          reason: "quota",
          providerInstanceId: ProviderInstanceId.make("codex"),
          resetAt: "2026-06-14T10:30:00.000Z",
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.stage-blocked");
      expect(singleEvent?.payload).toMatchObject({
        taskId: asTaskId("task-1"),
        role: "work",
        stageThreadId: asThreadId("thread-stage-work"),
        reason: "quota",
        providerInstanceId: ProviderInstanceId.make("codex"),
        resetAt: "2026-06-14T10:30:00.000Z",
      });
    }),
  );

  it.effect("rejects quota blocking for an inactive stage thread", () =>
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
            type: "task.stage.block",
            commandId: asCommandId("cmd-stage-block-old"),
            taskId: asTaskId("task-1"),
            role: "work",
            stageThreadId: asThreadId("thread-stage-old"),
            reason: "quota",
            providerInstanceId: ProviderInstanceId.make("codex"),
            createdAt: now,
          },
        }),
      );

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("allows quota resumption until maxRetriesPerStage is exceeded", () =>
    Effect.gen(function* () {
      const readModel = {
        ...(yield* taskReadModel({
          status: "blocked-on-quota",
          currentStageThreadId: null,
          stageThreadIds: [asThreadId("thread-stage-block-1"), asThreadId("thread-stage-block-2")],
        })),
        quotaBlockedStages: [
          {
            taskId: asTaskId("task-1"),
            stageThreadId: asThreadId("thread-stage-block-1"),
            role: "work" as const,
            providerInstanceId: ProviderInstanceId.make("codex"),
            resetAt: null,
            status: "resumed" as const,
            retryCount: 1,
            blockedAt: "2026-06-14T10:00:00.000Z",
            resumedAt: "2026-06-14T10:05:00.000Z",
          },
          {
            taskId: asTaskId("task-1"),
            stageThreadId: asThreadId("thread-stage-block-2"),
            role: "work" as const,
            providerInstanceId: ProviderInstanceId.make("codex"),
            resetAt: null,
            status: "blocked" as const,
            retryCount: 2,
            blockedAt: "2026-06-14T10:10:00.000Z",
            resumedAt: null,
          },
        ],
      };

      const accepted = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.stage.start",
          commandId: asCommandId("cmd-stage-resume-accepted"),
          taskId: asTaskId("task-1"),
          role: "work",
          instructions: "Retry the worker.",
          createdAt: now,
        },
      });
      expect(Array.isArray(accepted)).toBe(true);

      const rejected = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: {
            ...readModel,
            quotaBlockedStages: [
              ...readModel.quotaBlockedStages.slice(0, 1),
              {
                ...readModel.quotaBlockedStages[1]!,
                retryCount: 3,
              },
            ],
          },
          command: {
            type: "task.stage.start",
            commandId: asCommandId("cmd-stage-resume-rejected"),
            taskId: asTaskId("task-1"),
            role: "work",
            instructions: "Retry the worker again.",
            createdAt: now,
          },
        }),
      );
      expect(rejected._tag).toBe("Failure");
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

  it.effect("auto-approves a plan gate when the task type policy is auto", () =>
    Effect.gen(function* () {
      const contentHash = "sha256:auto-plan";
      const readModel = yield* taskReadModel(
        {
          status: "working",
          currentStageThreadId: asThreadId("thread-stage-work"),
          stageThreadIds: [asThreadId("thread-stage-work")],
        },
        {
          orchestratorConfig: {
            enabled: true,
            taskTypes: [
              {
                id: "feature",
                gatePolicy: {
                  plan: "auto",
                  land: "require-approval",
                },
              },
            ],
          },
        },
      );

      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.gate.request",
          commandId: asCommandId("cmd-gate-request-auto"),
          taskId: asTaskId("task-1"),
          gateId: asGateId("gate-auto-plan"),
          gate: "plan",
          contentHash,
          stageThreadId: asThreadId("thread-stage-work"),
          createdAt: now,
        },
      });
      const events = toEvents(result);
      const projected = yield* applyEvents(readModel, events);

      expect(events.map((event) => event.type)).toEqual([
        "task.gate-requested",
        "task.gate-resolved",
      ]);
      expect(events[1]?.payload).toMatchObject({
        gateId: asGateId("gate-auto-plan"),
        gate: "plan",
        approvedHash: contentHash,
        decision: "approved",
        origin: "system",
        updatedAt: now,
      });
      expect(projected.tasks.find((task) => task.id === asTaskId("task-1"))?.status).toBe(
        "planning",
      );
      expect(
        (projected.pendingGates ?? []).find((gate) => gate.gateId === asGateId("gate-auto-plan")),
      ).toMatchObject({
        status: "resolved",
        approvedHash: contentHash,
        decision: "approved",
        origin: "system",
      });
    }),
  );

  it.effect("requires approval for a plan gate when the task type policy requires approval", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        {
          status: "working",
          currentStageThreadId: asThreadId("thread-stage-work"),
          stageThreadIds: [asThreadId("thread-stage-work")],
        },
        {
          orchestratorConfig: {
            enabled: true,
            taskTypes: [
              {
                id: "feature",
                gatePolicy: {
                  plan: "require-approval",
                  land: "require-approval",
                },
              },
            ],
          },
        },
      );

      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.gate.request",
          commandId: asCommandId("cmd-gate-request-manual"),
          taskId: asTaskId("task-1"),
          gateId: asGateId("gate-manual-plan"),
          gate: "plan",
          contentHash: "sha256:manual-plan",
          stageThreadId: asThreadId("thread-stage-work"),
          createdAt: now,
        },
      });
      const events = toEvents(result);
      const projected = yield* applyEvents(readModel, events);

      expect(events.map((event) => event.type)).toEqual(["task.gate-requested"]);
      expect(projected.tasks.find((task) => task.id === asTaskId("task-1"))?.status).toBe(
        "plan-review",
      );
      expect(
        (projected.pendingGates ?? []).find((gate) => gate.gateId === asGateId("gate-manual-plan")),
      ).toMatchObject({
        status: "pending",
        approvedHash: null,
        decision: null,
        origin: null,
      });
    }),
  );

  it.effect("inherits global gate policy when the project gate policy is omitted", () =>
    Effect.gen(function* () {
      const contentHash = "sha256:global-plan";
      const readModel = yield* taskReadModel({
        status: "working",
        currentStageThreadId: asThreadId("thread-stage-work"),
        stageThreadIds: [asThreadId("thread-stage-work")],
      });

      const result = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: {
          gatePolicy: {
            plan: "auto",
            land: "require-approval",
          },
        },
        command: {
          type: "task.gate.request",
          commandId: asCommandId("cmd-gate-request-global-auto"),
          taskId: asTaskId("task-1"),
          gateId: asGateId("gate-global-plan"),
          gate: "plan",
          contentHash,
          stageThreadId: asThreadId("thread-stage-work"),
          createdAt: now,
        },
      });

      expect(toEvents(result).map((event) => event.type)).toEqual([
        "task.gate-requested",
        "task.gate-resolved",
      ]);
    }),
  );

  it.effect("uses explicitly-set project gate policy over global gate policy", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        {
          status: "working",
          currentStageThreadId: asThreadId("thread-stage-work"),
          stageThreadIds: [asThreadId("thread-stage-work")],
        },
        {
          orchestratorConfig: {
            enabled: true,
            taskTypes: [
              {
                id: "feature",
                gatePolicy: {
                  plan: "require-approval",
                  land: "require-approval",
                },
              },
            ],
          },
        },
      );

      const result = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: {
          gatePolicy: {
            plan: "auto",
            land: "require-approval",
          },
        },
        command: {
          type: "task.gate.request",
          commandId: asCommandId("cmd-gate-request-project-manual"),
          taskId: asTaskId("task-1"),
          gateId: asGateId("gate-project-plan"),
          gate: "plan",
          contentHash: "sha256:project-plan",
          stageThreadId: asThreadId("thread-stage-work"),
          createdAt: now,
        },
      });

      expect(toEvents(result).map((event) => event.type)).toEqual(["task.gate-requested"]);
    }),
  );

  it.effect("keeps a fully-configured project's own limits, stages, and gate policy", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        {
          status: "working",
          currentStageThreadId: asThreadId("thread-stage-work"),
          stageThreadIds: [asThreadId("thread-stage-work")],
        },
        {
          orchestratorConfig: {
            enabled: true,
            pmModelSelection: null,
            taskTypes: [
              {
                id: "feature",
                stages: ["classify", "plan", "work", "verify"],
                gatePolicy: {
                  classify: "require-approval",
                  plan: "require-approval",
                  work: "require-approval",
                  review: "require-approval",
                  land: "require-approval",
                },
              },
            ],
            resourceLimits: {
              maxParallelTasks: 1,
              maxParallelWorkers: 1,
              maxStageHandoffs: 8,
              maxRetriesPerStage: 2,
              allowFullAccessWorkers: false,
            },
          },
        },
      );
      const globals = {
        stages: ["classify", "plan", "review", "work", "verify"],
        gatePolicy: {
          plan: "auto",
          land: "require-approval",
        },
        maxParallelTasks: 2,
      } as const;

      const taskCreate = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          orchestratorDefaults: globals,
          command: {
            type: "task.create",
            commandId: asCommandId("cmd-create-task-fully-configured"),
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
      expect(taskCreate._tag).toBe("Failure");

      const stageStart = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: {
            ...readModel,
            tasks: [{ ...readModel.tasks[0]!, currentStageThreadId: null }],
          },
          orchestratorDefaults: globals,
          command: {
            type: "task.stage.start",
            commandId: asCommandId("cmd-stage-start-fully-configured"),
            taskId: asTaskId("task-1"),
            role: "review",
            instructions: "Review the accepted plan.",
            createdAt: now,
          },
        }),
      );
      expect(stageStart._tag).toBe("Failure");

      const gateRequest = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: globals,
        command: {
          type: "task.gate.request",
          commandId: asCommandId("cmd-gate-request-fully-configured"),
          taskId: asTaskId("task-1"),
          gateId: asGateId("gate-fully-configured-plan"),
          gate: "plan",
          contentHash: "sha256:fully-configured-plan",
          stageThreadId: asThreadId("thread-stage-work"),
          createdAt: now,
        },
      });
      expect(toEvents(gateRequest).map((event) => event.type)).toEqual(["task.gate-requested"]);
    }),
  );

  it.effect("never auto-approves a land gate", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel(
        {
          status: "review",
          currentStageThreadId: null,
          stageThreadIds: [asThreadId("thread-stage-work")],
        },
        {
          orchestratorConfig: {
            enabled: true,
            taskTypes: [
              {
                id: "feature",
                gatePolicy: {
                  plan: "auto",
                  land: "require-approval",
                },
              },
            ],
          },
        },
      );

      const result = yield* decideOrchestrationCommand({
        readModel,
        orchestratorDefaults: {
          gatePolicy: {
            land: "auto",
          },
        },
        command: {
          type: "task.gate.request",
          commandId: asCommandId("cmd-gate-request-land"),
          taskId: asTaskId("task-1"),
          gateId: asGateId("gate-land"),
          gate: "land",
          contentHash: "sha256:land",
          stageThreadId: asThreadId("thread-stage-work"),
          createdAt: now,
        },
      });
      const events = toEvents(result);
      const projected = yield* applyEvents(readModel, events);

      expect(events.map((event) => event.type)).toEqual(["task.gate-requested"]);
      expect(projected.tasks.find((task) => task.id === asTaskId("task-1"))?.status).toBe("review");
      expect(
        (projected.pendingGates ?? []).find((gate) => gate.gateId === asGateId("gate-land")),
      ).toMatchObject({
        status: "pending",
        approvedHash: null,
        decision: null,
        origin: null,
      });
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

  it.effect("records an opened PR through an internal task command", () =>
    Effect.gen(function* () {
      const readModel = yield* taskReadModel({ status: "landed" });

      const event = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "task.pr.opened",
          commandId: asCommandId("cmd-pr-opened"),
          taskId: asTaskId("task-1"),
          prUrl: "https://github.com/acme/repo/pull/42",
          prNumber: 42,
          createdAt: now,
        },
      });

      const singleEvent = Array.isArray(event) ? event[0] : event;
      expect(singleEvent?.type).toBe("task.pr-opened");
      expect(singleEvent?.payload).toMatchObject({
        taskId: asTaskId("task-1"),
        prUrl: "https://github.com/acme/repo/pull/42",
        prNumber: 42,
        updatedAt: now,
      });
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
