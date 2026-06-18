import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  PmRuntimeStateRepository,
  type ConsumePmSettlementInput,
} from "../../persistence/Services/PmRuntimeState.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PmProjectRuntimeFactory,
  PmRuntime,
  type PmProjectRuntime,
} from "../Services/PmRuntime.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { PmRuntimeLive } from "./PmRuntime.ts";

const now = "2026-06-14T10:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const stageThreadId = ThreadId.make("thread-stage-1");
const turnId = TurnId.make("turn-1");

const project: OrchestrationProject = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/tmp/project",
  repositoryIdentity: null,
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  roleModelSelections: {},
  orchestratorConfig: {
    enabled: true,
    pmModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
  },
  scripts: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const task: OrchestrationTask = {
  id: taskId,
  projectId,
  type: TaskTypeId.make("feature"),
  title: "Implement feature",
  status: "review",
  branch: "orchestrator/task-1",
  worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
  pmMessageId: MessageId.make("pm-message-1"),
  stageThreadIds: [stageThreadId],
  currentStageThreadId: null,
  playbookVersion: "feature@v1",
  createdAt: now,
  updatedAt: now,
};

const readModel: OrchestrationReadModel = {
  snapshotSequence: 3,
  projects: [project],
  threads: [],
  tasks: [task],
  pendingGates: [],
  updatedAt: now,
};

const stageThread: OrchestrationThread = {
  id: stageThreadId,
  projectId,
  title: "Implement feature (work)",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  gedWorkflowEnabled: false,
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: "orchestrator/task-1",
  worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
  latestTurn: {
    turnId,
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: MessageId.make("assistant-1"),
  },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  messages: [
    {
      id: MessageId.make("assistant-1"),
      role: "assistant",
      text: "Implemented it. OPENAI_API_KEY=sk-live-secret should not leak.",
      attachments: [],
      turnId,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const stageCompletedEvent: OrchestrationEvent = {
  sequence: 10,
  eventId: EventId.make("evt-stage-completed"),
  aggregateKind: "task",
  aggregateId: taskId,
  type: "task.stage-completed",
  occurredAt: now,
  commandId: CommandId.make("cmd-stage-completed"),
  causationEventId: null,
  correlationId: CommandId.make("cmd-stage-completed"),
  metadata: {},
  payload: {
    taskId,
    role: "work",
    stageThreadId,
    awaitedTurnId: turnId,
    updatedAt: now,
  },
};

const makeLayer = (input: {
  readonly liveEvents: ReadonlyArray<OrchestrationEvent>;
  readonly historicalEvents: ReadonlyArray<OrchestrationEvent>;
  readonly consumed: Set<string>;
  readonly messages: string[];
  readonly consumeCalls: ConsumePmSettlementInput[];
  readonly cursorByProject?: Map<string, number>;
  readonly readEventCursors?: number[];
}) => {
  const cursorByProject = input.cursorByProject ?? new Map<string, number>();
  const readEventCursors = input.readEventCursors ?? [];
  const projectRuntime: PmProjectRuntime = {
    enqueue: (message) =>
      Effect.sync(() => {
        input.messages.push(message);
      }),
    drain: Effect.void,
  };

  return PmRuntimeLive.pipe(
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        readEvents: (fromSequenceExclusive: number) => {
          readEventCursors.push(fromSequenceExclusive);
          return Stream.fromIterable(
            input.historicalEvents.filter((event) => event.sequence > fromSequenceExclusive),
          );
        },
        dispatch: () => Effect.die("dispatch should not be called by PmRuntime"),
        streamDomainEvents: Stream.fromIterable(input.liveEvents),
        streamShellEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getCommandReadModel: () => Effect.succeed(readModel),
        getThreadDetailById: (threadId: ThreadId) =>
          Effect.succeed(threadId === stageThreadId ? Option.some(stageThread) : Option.none()),
      }),
    ),
    Layer.provide(
      Layer.succeed(PmRuntimeStateRepository, {
        getCursor: ({ projectId }) =>
          Effect.sync(() => {
            const lastConsumedSequence = cursorByProject.get(String(projectId));
            return lastConsumedSequence === undefined
              ? Option.none()
              : Option.some({ projectId, lastConsumedSequence, updatedAt: now });
          }),
        listConsumedSettlements: () => Effect.succeed([]),
        consumeSettlementAndAdvanceCursor: (consumeInput: ConsumePmSettlementInput) =>
          Effect.sync(() => {
            input.consumeCalls.push(consumeInput);
            const key = `${consumeInput.projectId}:${consumeInput.kind}:${consumeInput.settlementKey}`;
            if (input.consumed.has(key)) {
              return false;
            }
            input.consumed.add(key);
            cursorByProject.set(
              String(consumeInput.projectId),
              Math.max(
                cursorByProject.get(String(consumeInput.projectId)) ?? 0,
                consumeInput.sequence,
              ),
            );
            return true;
          }),
      }),
    ),
    Layer.provide(
      Layer.succeed(PmProjectRuntimeFactory, {
        getOrCreate: () => Effect.succeed(projectRuntime),
      }),
    ),
  );
};

describe("PmRuntime", () => {
  it.effect("replays duplicate settled worker stages exactly once", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent, stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 1);
      assert.match(messages[0] ?? "", /A detached worker stage completed/);
      assert.notMatch(messages[0] ?? "", /sk-live-secret/);
      assert.match(messages[0] ?? "", /OPENAI_API_KEY=\[REDACTED\]/);
      assert.strictEqual(consumeCalls.length, 1);
    }),
  );

  it.effect("buffers live restart-window duplicates until after historical replay", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const readEventCursors: number[] = [];
      const layer = makeLayer({
        liveEvents: [stageCompletedEvent],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        readEventCursors,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.deepStrictEqual(readEventCursors, [0]);
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(consumeCalls.length, 1);
    }),
  );

  it.effect("starts historical replay from the durable project cursor", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const readEventCursors: number[] = [];
      const cursorByProject = new Map<string, number>([
        [String(projectId), stageCompletedEvent.sequence],
      ]);
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        cursorByProject,
        readEventCursors,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.deepStrictEqual(readEventCursors, [stageCompletedEvent.sequence]);
      assert.deepStrictEqual(messages, []);
      assert.deepStrictEqual(consumeCalls, []);
    }),
  );
});
