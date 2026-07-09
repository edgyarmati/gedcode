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
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { CheckpointDiffQuery } from "../checkpointing/Services/CheckpointDiffQuery.ts";
import { ProjectionAwaitedStageRepository } from "../persistence/Services/ProjectionAwaitedStages.ts";
import { ProjectionQuotaBlockedStageRepository } from "../persistence/Services/ProjectionQuotaBlockedStages.ts";
import { ProviderQuotaStatusRepository } from "../persistence/Services/ProviderQuotaStatus.ts";
import {
  PmRuntimeStateRepository,
  type ConsumePmSettlementInput,
} from "../persistence/Services/PmRuntimeState.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { PmProjectRuntimeFactory, PmRuntime, type PmProjectRuntime } from "./Services/PmRuntime.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { OrchestrationMcpServerProviderLive } from "./claude/OrchestrationMcpServerProvider.ts";
import { PmRuntimeLive } from "./Layers/PmRuntime.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

const now = "2026-06-18T08:00:00.000Z";
const projectId = ProjectId.make("project-orch-e2e");
const taskId = TaskId.make("task-orch-e2e");
const pmMessageId = MessageId.make("pm-message-orch-e2e");
const planGateId = GateId.make("gate-plan-e2e");
const landGateId = GateId.make("gate-land-e2e");
const awaitedTurnId = TurnId.make("turn-worker-e2e");

function makeProjectCreatedEvent(): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: EventId.make("event-project-orch-e2e"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("cmd-project-orch-e2e"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-project-orch-e2e"),
    metadata: {},
    payload: {
      projectId,
      title: "Orchestrator E2E",
      workspaceRoot: "/tmp/orchestrator-e2e",
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      roleModelSelections: {},
      orchestratorConfig: {
        enabled: true,
        pmModelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
        },
      },
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  };
}

function withSequence(event: PlannedEvent, sequence: number): OrchestrationEvent {
  return {
    ...event,
    sequence,
  } as OrchestrationEvent;
}

const toEvents = (result: PlannedEvent | ReadonlyArray<PlannedEvent>): PlannedEvent[] =>
  Array.isArray(result) ? [...(result as ReadonlyArray<PlannedEvent>)] : [result as PlannedEvent];

const applyEvents = Effect.fn("orchestratorSlice.applyEvents")(function* (
  readModel: OrchestrationReadModel,
  plannedEvents: ReadonlyArray<PlannedEvent>,
) {
  let nextModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const events: OrchestrationEvent[] = [];

  for (const plannedEvent of plannedEvents) {
    nextSequence += 1;
    const event = withSequence(plannedEvent, nextSequence);
    events.push(event);
    nextModel = yield* projectEvent(nextModel, event);
  }

  return { events, readModel: nextModel };
});

const decideAndApply = Effect.fn("orchestratorSlice.decideAndApply")(function* (
  readModel: OrchestrationReadModel,
  command: OrchestrationCommand,
) {
  const result = yield* decideOrchestrationCommand({ readModel, command });
  return yield* applyEvents(readModel, toEvents(result));
});

function latestTask(readModel: OrchestrationReadModel): OrchestrationTask {
  const task = readModel.tasks.find((entry) => entry.id === taskId);
  assert.ok(task);
  return task;
}

function latestProject(readModel: OrchestrationReadModel): OrchestrationProject {
  const project = readModel.projects.find((entry) => entry.id === projectId);
  assert.ok(project);
  return project;
}

function findEvent<TType extends OrchestrationEvent["type"]>(
  events: ReadonlyArray<OrchestrationEvent>,
  type: TType,
): Extract<OrchestrationEvent, { type: TType }> {
  const event = events.find((entry) => entry.type === type);
  assert.ok(event);
  return event as Extract<OrchestrationEvent, { type: TType }>;
}

function attachWorkerResult(
  readModel: OrchestrationReadModel,
  stageThreadId: ThreadId,
): OrchestrationReadModel {
  return {
    ...readModel,
    threads: readModel.threads.map((thread) =>
      thread.id === stageThreadId
        ? ({
            ...thread,
            latestTurn: {
              turnId: awaitedTurnId,
              state: "completed",
              requestedAt: now,
              startedAt: now,
              completedAt: now,
              assistantMessageId: MessageId.make("assistant-worker-e2e"),
            },
            messages: [
              ...thread.messages,
              {
                id: MessageId.make("assistant-worker-e2e"),
                role: "assistant",
                text: [
                  "Implemented the requested change.",
                  "Diff summary: modified apps/server/src/orchestration/decider.ts.",
                  "SECRET_TOKEN=super-secret-value",
                ].join("\n"),
                attachments: [],
                turnId: awaitedTurnId,
                streaming: false,
                createdAt: now,
                updatedAt: now,
              },
            ],
          } satisfies OrchestrationThread)
        : thread,
    ),
  };
}

function makePmRuntimeLayer(input: {
  readonly readModel: OrchestrationReadModel;
  readonly stageThreadId: ThreadId;
  readonly historicalEvents: ReadonlyArray<OrchestrationEvent>;
  readonly liveEvents: ReadonlyArray<OrchestrationEvent>;
  readonly messages: string[];
  readonly consumeCalls: ConsumePmSettlementInput[];
}) {
  const consumed = new Set<string>();
  const projectRuntime: PmProjectRuntime = {
    surfaceUserMessage: (message) =>
      Effect.sync(() => {
        input.messages.push(`surface:${message}`);
      }),
    createHandoffBrief: Effect.succeed("handoff brief"),
    enqueue: (message) =>
      Effect.sync(() => {
        input.messages.push(message);
      }),
    drain: Effect.void,
  };

  return PmRuntimeLive.pipe(
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        readEvents: (fromSequenceExclusive: number) =>
          Stream.fromIterable(
            input.historicalEvents.filter((event) => event.sequence > fromSequenceExclusive),
          ),
        dispatch: () => Effect.die("dispatch should not be called by PmRuntime"),
        streamDomainEvents: Stream.fromIterable(input.liveEvents),
        streamShellEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getCommandReadModel: () => Effect.succeed(input.readModel),
        getThreadDetailById: (threadId: ThreadId) => {
          const thread = input.readModel.threads.find((entry) => entry.id === threadId);
          return Effect.succeed(thread ? Option.some(thread) : Option.none());
        },
        // No captured checkpoint in this slice → diff-unavailable; the stage
        // result envelope is built without a diff section.
        getFullThreadDiffContext: () => Effect.succeed(Option.none()),
      }),
    ),
    Layer.provide(
      Layer.mock(CheckpointDiffQuery)({
        getFullThreadDiff: () =>
          Effect.die("getFullThreadDiff should not be called (no diff context)"),
      }),
    ),
    Layer.provide(
      Layer.succeed(PmRuntimeStateRepository, {
        getCursor: () => Effect.succeed(Option.none()),
        listConsumedSettlements: () => Effect.succeed([]),
        listPending: () => Effect.succeed([]),
        consumeSettlementAndAdvanceCursor: (consumeInput: ConsumePmSettlementInput) =>
          Effect.sync(() => {
            input.consumeCalls.push(consumeInput);
            const key = `${consumeInput.projectId}:${consumeInput.kind}:${consumeInput.settlementKey}`;
            if (consumed.has(key)) {
              return false;
            }
            consumed.add(key);
            return true;
          }),
        markActed: () => Effect.void,
      }),
    ),
    Layer.provide(
      Layer.succeed(ProjectionAwaitedStageRepository, {
        upsert: () => Effect.void,
        listByTaskId: () => Effect.succeed([]),
      }),
    ),
    Layer.provide(
      Layer.succeed(ProjectionQuotaBlockedStageRepository, {
        upsert: () => Effect.void,
        listByTaskId: () => Effect.succeed([]),
        listBlockedByProviderInstanceId: () => Effect.succeed([]),
        listBlocked: () => Effect.succeed([]),
        listAll: () => Effect.succeed([]),
      }),
    ),
    Layer.provide(
      Layer.succeed(ProviderQuotaStatusRepository, {
        upsert: () =>
          Effect.die("ProviderQuotaStatusRepository.upsert should not be called by e2e"),
        markBlocked: () =>
          Effect.die("ProviderQuotaStatusRepository.markBlocked should not be called by e2e"),
        observeRuntimeStatus: () =>
          Effect.die(
            "ProviderQuotaStatusRepository.observeRuntimeStatus should not be called by e2e",
          ),
        getByProviderInstanceId: () => Effect.succeed(Option.none()),
        // The PM re-entry quota gate (WP-Q5) reads this on every settlement; the
        // e2e PM instance has headroom, so report not-blocked.
        isInstanceQuotaBlocked: ({ providerInstanceId }) =>
          Effect.succeed({ providerInstanceId, status: "ok", blocked: false, resetAt: null }),
        listBlocked: () => Effect.succeed([]),
      }),
    ),
    Layer.provide(
      Layer.succeed(PmProjectRuntimeFactory, {
        getOrCreate: () => Effect.succeed(projectRuntime),
        waitForIdle: () => Effect.void,
        invalidateRuntime: () => Effect.void,
        clearSessionStorage: () => Effect.void,
        resetSessionBinding: () => Effect.void,
        createHandoffBrief: () => Effect.succeed(Option.none()),
      }),
    ),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(OrchestrationMcpServerProviderLive),
  );
}

it.layer(NodeServices.layer)("orchestrator slice mocked e2e", (it) => {
  it.effect("hands off one worker, gates human approval, survives restart replay, and lands", () =>
    Effect.gen(function* () {
      let readModel = yield* projectEvent(createEmptyReadModel(now), makeProjectCreatedEvent());

      readModel = (yield* decideAndApply(readModel, {
        type: "task.create",
        commandId: CommandId.make("cmd-task-create-e2e"),
        taskId,
        projectId,
        taskType: TaskTypeId.make("feature"),
        title: "Finish orchestrator slice",
        pmMessageId,
        branch: null,
        createdAt: now,
      })).readModel;
      expect(latestTask(readModel).branch).toBe("orchestrator/task-orch-e2e");
      expect(latestTask(readModel).worktreePath).toContain("task-orch-e2e");

      readModel = (yield* decideAndApply(readModel, {
        type: "task.classify",
        commandId: CommandId.make("cmd-classify-e2e"),
        taskId,
        taskType: TaskTypeId.make("feature"),
        playbookVersion: "feature@v1",
        createdAt: now,
      })).readModel;

      const handoff = yield* decideAndApply(readModel, {
        type: "task.stage.start",
        commandId: CommandId.make("cmd-handoff-e2e"),
        taskId,
        role: "work",
        instructions: "Implement the accepted plan and leave the diff in the task worktree.",
        createdAt: now,
      });
      readModel = handoff.readModel;
      const stageStarted = findEvent(handoff.events, "task.stage-started");
      const turnRequested = findEvent(handoff.events, "thread.turn-start-requested");
      expect(stageStarted.payload.role).toBe("work");
      expect(turnRequested.payload.threadId).toBe(stageStarted.payload.stageThreadId);
      expect(latestTask(readModel).status).toBe("working");

      readModel = (yield* decideAndApply(readModel, {
        type: "task.gate.request",
        commandId: CommandId.make("cmd-plan-gate-e2e"),
        taskId,
        gateId: planGateId,
        gate: "plan",
        contentHash: "sha256:plan-e2e",
        stageThreadId: stageStarted.payload.stageThreadId,
        createdAt: now,
      })).readModel;
      expect(latestTask(readModel).status).toBe("plan-review");

      const pmGateAttempt = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "task.gate.resolve",
            commandId: CommandId.make("cmd-plan-gate-pm-e2e"),
            taskId,
            gateId: planGateId,
            gate: "plan",
            approvedHash: "sha256:plan-e2e",
            decision: "approved",
            origin: "pm-runtime",
            createdAt: now,
          },
        }),
      );
      expect(pmGateAttempt._tag).toBe("Failure");

      readModel = (yield* decideAndApply(readModel, {
        type: "task.gate.resolve",
        commandId: CommandId.make("cmd-plan-gate-human-e2e"),
        taskId,
        gateId: planGateId,
        gate: "plan",
        approvedHash: "sha256:plan-e2e",
        decision: "approved",
        origin: "human",
        createdAt: now,
      })).readModel;

      const stageComplete = yield* decideAndApply(readModel, {
        type: "task.stage.complete",
        commandId: CommandId.make("cmd-stage-complete-e2e"),
        taskId,
        role: "work",
        stageThreadId: stageStarted.payload.stageThreadId,
        awaitedTurnId,
        createdAt: now,
      });
      readModel = attachWorkerResult(stageComplete.readModel, stageStarted.payload.stageThreadId);
      const stageCompleted = findEvent(stageComplete.events, "task.stage-completed");
      expect(latestTask(readModel).status).toBe("review");
      expect(latestTask(readModel).currentStageThreadId).toBeNull();

      const pmMessages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(
        Effect.scoped,
        Effect.provide(
          makePmRuntimeLayer({
            readModel,
            stageThreadId: stageStarted.payload.stageThreadId,
            historicalEvents: [stageCompleted],
            liveEvents: [stageCompleted],
            messages: pmMessages,
            consumeCalls,
          }),
        ),
      );
      expect(pmMessages).toHaveLength(1);
      expect(pmMessages[0]).toContain("A detached worker stage completed.");
      expect(pmMessages[0]).toContain("SECRET_TOKEN=[REDACTED]");
      expect(consumeCalls).toHaveLength(1);

      readModel = (yield* decideAndApply(readModel, {
        type: "task.gate.request",
        commandId: CommandId.make("cmd-land-gate-e2e"),
        taskId,
        gateId: landGateId,
        gate: "land",
        contentHash: "sha256:land-e2e",
        stageThreadId: stageStarted.payload.stageThreadId,
        createdAt: now,
      })).readModel;
      readModel = (yield* decideAndApply(readModel, {
        type: "task.gate.resolve",
        commandId: CommandId.make("cmd-land-gate-human-e2e"),
        taskId,
        gateId: landGateId,
        gate: "land",
        approvedHash: "sha256:land-e2e",
        decision: "approved",
        origin: "human",
        createdAt: now,
      })).readModel;
      readModel = (yield* decideAndApply(readModel, {
        type: "task.land",
        commandId: CommandId.make("cmd-land-e2e"),
        taskId,
        createdAt: now,
      })).readModel;

      expect(latestTask(readModel)).toMatchObject({
        status: "landed",
        branch: "orchestrator/task-orch-e2e",
      });
      expect(latestProject(readModel).orchestratorConfig).toMatchObject({ enabled: true });
    }),
  );
});
