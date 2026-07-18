import {
  CommandId,
  EventId,
  HelperRunId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-07-18T00:00:00.000Z";
const projectId = ProjectId.make("project-helper");
const taskId = TaskId.make("task-helper");
const helperRunId = HelperRunId.make("helper-1");

const event = <T extends OrchestrationEvent>(value: T): T => value;

const projectCreated = event({
  sequence: 1,
  eventId: EventId.make("event-project-helper"),
  aggregateKind: "project",
  aggregateId: projectId,
  type: "project.created",
  occurredAt: now,
  commandId: CommandId.make("command-project-helper"),
  causationEventId: null,
  correlationId: CommandId.make("command-project-helper"),
  metadata: {},
  payload: {
    projectId,
    title: "Helper project",
    workspaceRoot: "/tmp/helper-project",
    defaultModelSelection: null,
    orchestratorConfig: {
      capabilityPresets: {
        cheap: { instanceId: ProviderInstanceId.make("codex-cheap"), model: "gpt-cheap" },
        smart: { instanceId: ProviderInstanceId.make("codex-smart"), model: "gpt-smart" },
        genius: { instanceId: ProviderInstanceId.make("codex-genius"), model: "gpt-genius" },
      },
    },
    scripts: [],
    createdAt: now,
    updatedAt: now,
  },
} satisfies Extract<OrchestrationEvent, { type: "project.created" }>);

const taskCreated = event({
  sequence: 2,
  eventId: EventId.make("event-task-helper"),
  aggregateKind: "task",
  aggregateId: taskId,
  type: "task.created",
  occurredAt: now,
  commandId: CommandId.make("command-task-helper"),
  causationEventId: null,
  correlationId: CommandId.make("command-task-helper"),
  metadata: {},
  payload: {
    taskId,
    projectId,
    taskType: TaskTypeId.make("feature"),
    title: "Explore helper runs",
    branch: "ged/feature/explore-helper-runs",
    worktreePath: "/tmp/helper-project/.gedcode/orchestrator/tasks/task-helper",
    pmMessageId: null,
    playbookVersion: "feature@v1",
    createdAt: now,
    updatedAt: now,
  },
} satisfies Extract<OrchestrationEvent, { type: "task.created" }>);

it.layer(NodeServices.layer)("helper run decisions", (it) => {
  it.effect("resolves a task helper preset once and replays its complete lifecycle", () =>
    Effect.gen(function* () {
      const withProject = yield* projectEvent(createEmptyReadModel(now), projectCreated);
      const initial = yield* projectEvent(withProject, taskCreated);
      const requested = yield* decideOrchestrationCommand({
        readModel: initial,
        command: {
          type: "helper.run.request",
          commandId: CommandId.make("command-helper-request"),
          helperRunId,
          projectId,
          attachment: { kind: "task", taskId },
          tier: "cheap",
          prompt: "Locate the relevant persistence boundaries.",
          createdAt: now,
        },
      });
      expect(Array.isArray(requested)).toBe(false);
      const requestedEvent = requested as Omit<
        Extract<OrchestrationEvent, { type: "helper.run-requested" }>,
        "sequence"
      >;
      expect(requestedEvent.type).toBe("helper.run-requested");
      expect(requestedEvent.aggregateKind).toBe("helper-run");
      expect(requestedEvent.payload).toMatchObject({
        helperRunId: "helper-1",
        accessMode: "read-only",
        tier: "cheap",
        providerInstanceId: "codex-cheap",
        model: "gpt-cheap",
      });

      const pending = yield* projectEvent(initial, { ...requestedEvent, sequence: 3 });
      expect(pending.helperRuns?.[0]).toMatchObject({ status: "pending", result: null });
      const started = yield* decideOrchestrationCommand({
        readModel: pending,
        command: {
          type: "helper.run.start",
          commandId: CommandId.make("command-helper-start"),
          helperRunId,
          providerThreadId: ThreadId.make("provider-helper-thread"),
          createdAt: now,
        },
      });
      const startedEvent = started as Omit<
        Extract<OrchestrationEvent, { type: "helper.run-started" }>,
        "sequence"
      >;
      const running = yield* projectEvent(pending, { ...startedEvent, sequence: 4 });
      expect(running.helperRuns?.[0]).toMatchObject({
        status: "running",
        providerThreadId: "provider-helper-thread",
      });
      const completed = yield* decideOrchestrationCommand({
        readModel: running,
        command: {
          type: "helper.run.complete",
          commandId: CommandId.make("command-helper-complete"),
          helperRunId,
          result: "The projection boundary is append-only.",
          createdAt: now,
        },
      });
      const completedEvent = completed as Omit<
        Extract<OrchestrationEvent, { type: "helper.run-completed" }>,
        "sequence"
      >;
      const terminal = yield* projectEvent(running, { ...completedEvent, sequence: 5 });
      expect(terminal.helperRuns?.[0]).toMatchObject({
        status: "completed",
        result: "The projection boundary is append-only.",
      });

      const duplicateCompletion = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: terminal,
          command: {
            type: "helper.run.complete",
            commandId: CommandId.make("command-helper-complete-again"),
            helperRunId,
            result: "duplicate",
            createdAt: now,
          },
        }),
      );
      expect(duplicateCompletion._tag).toBe("Failure");
    }),
  );

  it.effect("rejects a helper attachment from another project", () =>
    Effect.gen(function* () {
      const withProject = yield* projectEvent(createEmptyReadModel(now), projectCreated);
      const initial = yield* projectEvent(withProject, taskCreated);
      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: initial,
          command: {
            type: "helper.run.request",
            commandId: CommandId.make("command-helper-foreign"),
            helperRunId: HelperRunId.make("helper-foreign"),
            projectId: ProjectId.make("project-other"),
            attachment: { kind: "task", taskId },
            tier: "cheap",
            prompt: "Explore",
            createdAt: now,
          },
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects a helper attachment to a terminal task before archival settles", () =>
    Effect.gen(function* () {
      const withProject = yield* projectEvent(createEmptyReadModel(now), projectCreated);
      const initial = yield* projectEvent(withProject, taskCreated);
      const abandoned = yield* projectEvent(
        initial,
        event({
          sequence: 3,
          eventId: EventId.make("event-task-helper-abandoned"),
          aggregateKind: "task",
          aggregateId: taskId,
          type: "task.abandoned",
          occurredAt: now,
          commandId: CommandId.make("command-task-helper-abandoned"),
          causationEventId: null,
          correlationId: CommandId.make("command-task-helper-abandoned"),
          metadata: {},
          payload: { taskId, updatedAt: now },
        }),
      );

      expect(abandoned.tasks[0]?.status).toBe("abandoned");
      expect(abandoned.tasks[0]?.archivedAt).toBeNull();
      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: abandoned,
          command: {
            type: "helper.run.request",
            commandId: CommandId.make("command-helper-terminal-task"),
            helperRunId: HelperRunId.make("helper-terminal-task"),
            projectId,
            attachment: { kind: "task", taskId },
            tier: "cheap",
            prompt: "Explore",
            createdAt: now,
          },
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );
});
