import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProjectId,
  OrchestrationTaskLanding,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  ProviderInstanceId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import {
  ORCHESTRATION_PROJECTOR_NAMES,
  OrchestrationProjectionPipelineLive,
} from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const makeProjectionPipelinePrefixedTestLayer = (prefix: string) =>
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  );

const decodeTaskLandingJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(OrchestrationTaskLanding),
);

const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* Effect.result(fileSystem.stat(filePath));
    return fileInfo._tag === "Success";
  });

const BaseTestLayer = makeProjectionPipelinePrefixedTestLayer("t3-projection-pipeline-test-");

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect("bootstraps all projection states and writes projection rows", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-1"),
        occurredAt: now,
        commandId: CommandId.make("cmd-1"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        occurredAt: now,
        commandId: CommandId.make("cmd-2"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          title: "Thread 1",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        occurredAt: now,
        commandId: CommandId.make("cmd-3"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("message-1"),
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      const projectRows = yield* sql<{
        readonly projectId: string;
        readonly title: string;
        readonly scriptsJson: string;
      }>`
        SELECT
          project_id AS "projectId",
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
      `;
      assert.deepEqual(projectRows, [
        { projectId: "project-1", title: "Project 1", scriptsJson: "[]" },
      ]);

      const messageRows = yield* sql<{
        readonly messageId: string;
        readonly text: string;
      }>`
        SELECT
          message_id AS "messageId",
          text
        FROM projection_thread_messages
      `;
      assert.deepEqual(messageRows, [{ messageId: "message-1", text: "hello" }]);

      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        ORDER BY projector ASC
      `;
      assert.equal(stateRows.length, Object.keys(ORCHESTRATION_PROJECTOR_NAMES).length);
      for (const row of stateRows) {
        assert.equal(row.lastAppliedSequence, 3);
      }
    }),
  );

  it.effect("persists task retention tombstones without deleting the task row", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const taskId = TaskId.make("task-retention-projection");
      const projectId = ProjectId.make("project-retention-projection");
      const createdAt = "2026-07-12T07:00:00.000Z";
      const archivedAt = "2026-07-12T07:01:00.000Z";
      const restoredAt = "2026-07-12T07:02:00.000Z";
      const deletedAt = "2026-07-12T07:03:00.000Z";

      yield* eventStore.append({
        type: "task.created",
        eventId: EventId.make("evt-retention-create"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: createdAt,
        commandId: CommandId.make("cmd-retention-create"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-retention-create"),
        metadata: {},
        payload: {
          taskId,
          projectId,
          taskType: TaskTypeId.make("feature"),
          title: "Retain this task",
          branch: null,
          worktreePath: null,
          pmMessageId: null,
          playbookVersion: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* eventStore.append({
        type: "task.archived",
        eventId: EventId.make("evt-retention-archive"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: archivedAt,
        commandId: CommandId.make("cmd-retention-archive"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-retention-archive"),
        metadata: {},
        payload: { taskId, archivedAt, updatedAt: archivedAt },
      });
      yield* eventStore.append({
        type: "task.restored",
        eventId: EventId.make("evt-retention-restore"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: restoredAt,
        commandId: CommandId.make("cmd-retention-restore"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-retention-restore"),
        metadata: {},
        payload: { taskId, updatedAt: restoredAt },
      });
      yield* eventStore.append({
        type: "task.deleted",
        eventId: EventId.make("evt-retention-delete"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: deletedAt,
        commandId: CommandId.make("cmd-retention-delete"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-retention-delete"),
        metadata: {},
        payload: { taskId, deletedAt, updatedAt: deletedAt },
      });
      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly taskId: string;
        readonly title: string;
        readonly archivedAt: string | null;
        readonly deletedAt: string | null;
      }>`
        SELECT
          task_id AS "taskId",
          title,
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_tasks
        WHERE task_id = ${taskId}
      `;
      assert.deepEqual(rows, [{ taskId, title: "Retain this task", archivedAt: null, deletedAt }]);
    }),
  );

  it.effect("projects cancellation progress and ignores failures without a reservation", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project-cancellation-projection");
      const taskId = TaskId.make("task-cancellation-projection");
      const outOfOrderTaskId = TaskId.make("task-cancellation-out-of-order");
      const createdAt = "2026-07-11T00:00:00.000Z";
      const requestedAt = "2026-07-11T00:01:00.000Z";
      const interruptedAt = "2026-07-11T00:02:00.000Z";
      const failedAt = "2026-07-11T00:03:00.000Z";

      for (const [id, title] of [
        [taskId, "Cancellation projection"],
        [outOfOrderTaskId, "Out-of-order cancellation"],
      ] as const) {
        yield* eventStore.append({
          type: "task.created",
          eventId: EventId.make(`evt-create-${id}`),
          aggregateKind: "task",
          aggregateId: id,
          occurredAt: createdAt,
          commandId: CommandId.make(`cmd-create-${id}`),
          causationEventId: null,
          correlationId: CorrelationId.make(`cmd-create-${id}`),
          metadata: {},
          payload: {
            taskId: id,
            projectId,
            taskType: TaskTypeId.make("feature"),
            title,
            branch: null,
            worktreePath: null,
            pmMessageId: null,
            playbookVersion: null,
            createdAt,
            updatedAt: createdAt,
          },
        });
      }

      yield* eventStore.append({
        type: "task.cancellation-requested",
        eventId: EventId.make("evt-cancellation-requested"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: requestedAt,
        commandId: CommandId.make("cmd-cancellation-requested"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-cancellation-requested"),
        metadata: {},
        payload: {
          taskId,
          requestedAt,
          updatedAt: requestedAt,
        },
      });
      yield* eventStore.append({
        type: "task.cancellation-phase-completed",
        eventId: EventId.make("evt-cancellation-interrupted"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: interruptedAt,
        commandId: CommandId.make("cmd-cancellation-interrupted"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-cancellation-interrupted"),
        metadata: {},
        payload: {
          taskId,
          phase: "interrupt-turn",
          updatedAt: interruptedAt,
        },
      });
      yield* eventStore.append({
        type: "task.cancellation-failed",
        eventId: EventId.make("evt-cancellation-failed"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: failedAt,
        commandId: CommandId.make("cmd-cancellation-failed"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-cancellation-failed"),
        metadata: {},
        payload: {
          taskId,
          phase: "stop-session",
          message: "provider session did not stop",
          failedAt,
          updatedAt: failedAt,
        },
      });
      yield* eventStore.append({
        type: "task.cancellation-failed",
        eventId: EventId.make("evt-cancellation-failed-out-of-order"),
        aggregateKind: "task",
        aggregateId: outOfOrderTaskId,
        occurredAt: failedAt,
        commandId: CommandId.make("cmd-cancellation-failed-out-of-order"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-cancellation-failed-out-of-order"),
        metadata: {},
        payload: {
          taskId: outOfOrderTaskId,
          phase: "interrupt-turn",
          message: "no cancellation reservation",
          failedAt,
          updatedAt: failedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly taskId: string;
        readonly cancellation: string | null;
        readonly updatedAt: string;
      }>`
        SELECT
          task_id AS "taskId",
          cancellation_json AS cancellation,
          updated_at AS "updatedAt"
        FROM projection_tasks
        WHERE task_id IN (${taskId}, ${outOfOrderTaskId})
        ORDER BY task_id ASC
      `;
      assert.deepEqual(rows, [
        {
          taskId: "task-cancellation-out-of-order",
          cancellation: null,
          updatedAt: createdAt,
        },
        {
          taskId: "task-cancellation-projection",
          cancellation:
            '{"requestedAt":"2026-07-11T00:01:00.000Z","completedPhases":["interrupt-turn"],"failurePhase":"stop-session","failureMessage":"provider session did not stop","failedAt":"2026-07-11T00:03:00.000Z"}',
          updatedAt: failedAt,
        },
      ]);
    }),
  );

  it.effect("projects pending PM handoff state on request, completion, and clear", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";
      const threadId = ThreadId.make("pm:project-pm-handoff");

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-pm-handoff-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-pm-handoff-thread"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-pm-handoff-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.make("project-pm-handoff"),
          title: "PM Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("claude"),
            model: "claude-opus-4-6",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* eventStore.append({
        type: "thread.pm-handoff-requested",
        eventId: EventId.make("evt-pm-handoff-requested"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-pm-handoff-requested"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-pm-handoff-requested"),
        metadata: {},
        payload: {
          threadId,
          mode: "summary",
          brief: "Brief",
          createdAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;
      let rows = yield* sql<{ readonly pendingPmHandoff: string | null }>`
        SELECT pending_pm_handoff_json AS "pendingPmHandoff"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(rows[0]?.pendingPmHandoff ?? "null"), {
        mode: "summary",
        brief: "Brief",
        requestedAt: now,
      });

      const completedEvent: OrchestrationEvent = {
        sequence: 3,
        type: "thread.pm-handoff-completed",
        eventId: EventId.make("evt-pm-handoff-completed"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-pm-handoff-completed"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-pm-handoff-completed"),
        metadata: {},
        payload: {
          threadId,
          mode: "summary",
          createdAt: now,
        },
      };
      yield* projectionPipeline.projectEvent(completedEvent);
      rows = yield* sql<{ readonly pendingPmHandoff: string | null }>`
        SELECT pending_pm_handoff_json AS "pendingPmHandoff"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.equal(rows[0]?.pendingPmHandoff, null);

      const transcriptRequestEvent: OrchestrationEvent = {
        sequence: 4,
        type: "thread.pm-handoff-requested",
        eventId: EventId.make("evt-pm-handoff-requested-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-pm-handoff-requested-2"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-pm-handoff-requested-2"),
        metadata: {},
        payload: {
          threadId,
          mode: "transcript",
          createdAt: now,
        },
      };
      yield* projectionPipeline.projectEvent(transcriptRequestEvent);
      const clearedEvent: OrchestrationEvent = {
        sequence: 5,
        type: "thread.cleared",
        eventId: EventId.make("evt-pm-handoff-clear"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-pm-handoff-clear"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-pm-handoff-clear"),
        metadata: {},
        payload: {
          threadId,
          clearedAt: now,
        },
      };
      yield* projectionPipeline.projectEvent(clearedEvent);
      rows = yield* sql<{ readonly pendingPmHandoff: string | null }>`
        SELECT pending_pm_handoff_json AS "pendingPmHandoff"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.equal(rows[0]?.pendingPmHandoff, null);
    }),
  );

  it.effect("projects stage history with task-level model overrides and blocked status", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-06-22T00:00:00.000Z";
      const projectId = ProjectId.make("project-stage-history");
      const taskId = TaskId.make("task-stage-history");
      const stageThreadId = ThreadId.make("thread-stage-history");

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-stage-history-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: now,
        commandId: CommandId.make("cmd-stage-history-project"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stage-history-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Stage history project",
          workspaceRoot: "/tmp/stage-history-project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex_default"),
            model: "gpt-default",
          },
          roleModelSelections: {
            work: {
              instanceId: ProviderInstanceId.make("codex_project"),
              model: "gpt-project",
            },
          },
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "task.created",
        eventId: EventId.make("evt-stage-history-task"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: now,
        commandId: CommandId.make("cmd-stage-history-task"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stage-history-task"),
        metadata: {},
        payload: {
          taskId,
          projectId,
          taskType: TaskTypeId.make("feature"),
          title: "Stage history task",
          branch: "orchestrator/stage-history",
          worktreePath: "/tmp/stage-history-project/.gedcode/orchestrator/tasks/task-stage-history",
          pmMessageId: null,
          playbookVersion: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "task.role-selections-updated",
        eventId: EventId.make("evt-stage-history-role-selection"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: "2026-06-22T00:00:01.000Z",
        commandId: CommandId.make("cmd-stage-history-role-selection"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stage-history-role-selection"),
        metadata: {},
        payload: {
          taskId,
          roleModelSelections: {
            work: {
              instanceId: ProviderInstanceId.make("codex_task"),
              model: "gpt-task",
            },
          },
          origin: "client",
          updatedAt: "2026-06-22T00:00:01.000Z",
        },
      });

      yield* eventStore.append({
        type: "task.stage-started",
        eventId: EventId.make("evt-stage-history-started"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: "2026-06-22T00:00:02.000Z",
        commandId: CommandId.make("cmd-stage-history-start"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stage-history-start"),
        metadata: {},
        payload: {
          taskId,
          role: "work",
          stageThreadId,
          awaitedTurnId: null,
          updatedAt: "2026-06-22T00:00:02.000Z",
        },
      });

      yield* eventStore.append({
        type: "task.stage-blocked",
        eventId: EventId.make("evt-stage-history-blocked"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: "2026-06-22T00:00:03.000Z",
        commandId: CommandId.make("cmd-stage-history-block"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stage-history-block"),
        metadata: {},
        payload: {
          taskId,
          role: "work",
          stageThreadId,
          reason: "quota",
          providerInstanceId: ProviderInstanceId.make("codex_task"),
          updatedAt: "2026-06-22T00:00:03.000Z",
        },
      });

      yield* eventStore.append({
        type: "task.pr-opened",
        eventId: EventId.make("evt-stage-history-pr-opened"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: "2026-06-22T00:00:04.000Z",
        commandId: CommandId.make("cmd-stage-history-pr-opened"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stage-history-pr-opened"),
        metadata: {},
        payload: {
          taskId,
          prUrl: "https://github.com/acme/repo/pull/42",
          prNumber: 42,
          updatedAt: "2026-06-22T00:00:04.000Z",
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly providerInstanceId: string;
        readonly model: string;
        readonly status: string;
        readonly endedAt: string | null;
      }>`
        SELECT
          provider_instance_id AS "providerInstanceId",
          model,
          status,
          ended_at AS "endedAt"
        FROM projection_stage_history
        WHERE stage_thread_id = ${stageThreadId}
      `;
      assert.deepEqual(rows, [
        {
          providerInstanceId: "codex_task",
          model: "gpt-task",
          status: "blocked",
          endedAt: "2026-06-22T00:00:03.000Z",
        },
      ]);

      const taskRows = yield* sql<{
        readonly prUrl: string | null;
        readonly landing: string | null;
      }>`
        SELECT pr_url AS "prUrl", landing_json AS "landing"
        FROM projection_tasks
        WHERE task_id = ${taskId}
      `;
      assert.strictEqual(taskRows[0]?.prUrl, "https://github.com/acme/repo/pull/42");
      assert.deepEqual(decodeTaskLandingJson(taskRows[0]?.landing), {
        status: "completed",
        failureMessage: null,
        branchPushed: true,
        updatedAt: "2026-06-22T00:00:04.000Z",
      });
    }),
  );

  it.effect("clears projected thread activities only for the cleared thread", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-07-04T00:00:00.000Z";
      const projectId = ProjectId.make("project-clear-activities");
      const clearedThreadId = ThreadId.make("thread-clear-activities");
      const otherThreadId = ThreadId.make("thread-clear-activities-other");

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-clear-activities-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: now,
        commandId: CommandId.make("cmd-clear-activities-project"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-clear-activities-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Clear activities project",
          workspaceRoot: "/tmp/clear-activities-project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      for (const [threadId, label] of [
        [clearedThreadId, "cleared"],
        [otherThreadId, "other"],
      ] as const) {
        yield* eventStore.append({
          type: "thread.created",
          eventId: EventId.make(`evt-clear-activities-thread-${label}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.make(`cmd-clear-activities-thread-${label}`),
          causationEventId: null,
          correlationId: CorrelationId.make(`cmd-clear-activities-thread-${label}`),
          metadata: {},
          payload: {
            threadId,
            projectId,
            title: `Thread ${label}`,
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "approval-required",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.activity-appended",
          eventId: EventId.make(`evt-clear-activities-activity-${label}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.make(`cmd-clear-activities-activity-${label}`),
          causationEventId: null,
          correlationId: CorrelationId.make(`cmd-clear-activities-activity-${label}`),
          metadata: {},
          payload: {
            threadId,
            activity: {
              id: EventId.make(`activity-clear-activities-${label}`),
              tone: "info",
              kind: "provider.turn.start.failed",
              summary: `Activity ${label}`,
              payload: { label },
              turnId: null,
              createdAt: now,
            },
          },
        });
      }

      yield* eventStore.append({
        type: "thread.cleared",
        eventId: EventId.make("evt-clear-activities-clear"),
        aggregateKind: "thread",
        aggregateId: clearedThreadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-clear-activities-clear"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-clear-activities-clear"),
        metadata: {},
        payload: {
          threadId: clearedThreadId,
          clearedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      const clearedRows = yield* sql<{ readonly activityId: string }>`
        SELECT activity_id AS "activityId"
        FROM projection_thread_activities
        WHERE thread_id = ${clearedThreadId}
      `;
      assert.deepEqual(clearedRows, []);

      const otherRows = yield* sql<{ readonly activityId: string }>`
        SELECT activity_id AS "activityId"
        FROM projection_thread_activities
        WHERE thread_id = ${otherThreadId}
        ORDER BY activity_id ASC
      `;
      assert.deepEqual(otherRows, [{ activityId: "activity-clear-activities-other" }]);
    }),
  );

  it.effect("projects orphaned stage interruption across task, history, and awaited rows", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const taskId = TaskId.make("task-orphaned-projection");
      const stageThreadId = ThreadId.make("thread-orphaned-projection");
      const createdAt = "2026-07-11T02:00:00.000Z";
      const startedAt = "2026-07-11T02:01:00.000Z";
      const interruptedAt = "2026-07-11T02:02:00.000Z";

      yield* eventStore.append({
        type: "task.created",
        eventId: EventId.make("evt-orphaned-projection-create"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: createdAt,
        commandId: CommandId.make("cmd-orphaned-projection-create"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-orphaned-projection-create"),
        metadata: {},
        payload: {
          taskId,
          projectId: ProjectId.make("project-orphaned-projection"),
          taskType: TaskTypeId.make("feature"),
          title: "Orphaned projection",
          branch: null,
          worktreePath: null,
          pmMessageId: null,
          playbookVersion: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* eventStore.append({
        type: "task.stage-started",
        eventId: EventId.make("evt-orphaned-projection-start"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: startedAt,
        commandId: CommandId.make("cmd-orphaned-projection-start"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-orphaned-projection-start"),
        metadata: {},
        payload: {
          taskId,
          role: "work",
          stageThreadId,
          awaitedTurnId: TurnId.make("turn-orphaned-projection"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
          updatedAt: startedAt,
        },
      });
      yield* eventStore.append({
        type: "task.stage-interrupted",
        eventId: EventId.make("evt-orphaned-projection-interrupt"),
        aggregateKind: "task",
        aggregateId: taskId,
        occurredAt: interruptedAt,
        commandId: CommandId.make("cmd-orphaned-projection-interrupt"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-orphaned-projection-interrupt"),
        metadata: {},
        payload: {
          taskId,
          role: "work",
          stageThreadId,
          reason: "orphaned",
          updatedAt: interruptedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const taskRows = yield* sql<{
        readonly status: string;
        readonly currentStageThreadId: string | null;
      }>`
        SELECT status, current_stage_thread_id AS "currentStageThreadId"
        FROM projection_tasks
        WHERE task_id = ${taskId}
      `;
      assert.deepEqual(taskRows, [{ status: "blocked", currentStageThreadId: null }]);

      const historyRows = yield* sql<{ readonly status: string; readonly endedAt: string | null }>`
        SELECT status, ended_at AS "endedAt"
        FROM projection_stage_history
        WHERE stage_thread_id = ${stageThreadId}
      `;
      assert.deepEqual(historyRows, [{ status: "interrupted", endedAt: interruptedAt }]);

      const awaitedRows = yield* sql<{
        readonly status: string;
        readonly completedAt: string | null;
      }>`
        SELECT status, completed_at AS "completedAt"
        FROM projection_awaited_stages
        WHERE stage_thread_id = ${stageThreadId}
      `;
      assert.deepEqual(awaitedRows, [{ status: "interrupted", completedAt: interruptedAt }]);

      const quotaRows = yield* sql<{ readonly stageThreadId: string }>`
        SELECT stage_thread_id AS "stageThreadId"
        FROM projection_quota_blocked_stages
        WHERE stage_thread_id = ${stageThreadId}
      `;
      assert.deepEqual(quotaRows, []);
    }),
  );
});

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-base-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("stores message attachment references without mutating payloads", () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = "2026-01-01T00:00:00.000Z";

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.make("evt-attachments"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-attachments"),
          occurredAt: now,
          commandId: CommandId.make("cmd-attachments"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-attachments"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-attachments"),
            messageId: MessageId.make("message-attachments"),
            role: "user",
            text: "Inspect this",
            attachments: [
              {
                type: "image",
                id: "thread-attachments-att-1",
                name: "example.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments'
          `;
        assert.equal(rows.length, 1);
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
          {
            type: "image",
            id: "thread-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ]);
      }),
    );
  },
);

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-safe-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("preserves mixed image attachment metadata as-is", () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = "2026-01-01T00:00:00.000Z";

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.make("evt-attachments-safe"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-attachments-safe"),
          occurredAt: now,
          commandId: CommandId.make("cmd-attachments-safe"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-attachments-safe"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-attachments-safe"),
            messageId: MessageId.make("message-attachments-safe"),
            role: "user",
            text: "Inspect this",
            attachments: [
              {
                type: "image",
                id: "thread-attachments-safe-att-1",
                name: "untrusted.exe",
                mimeType: "image/x-unknown",
                sizeBytes: 5,
              },
              {
                type: "image",
                id: "thread-attachments-safe-att-2",
                name: "not-image.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments-safe'
          `;
        assert.equal(rows.length, 1);
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
          {
            type: "image",
            id: "thread-attachments-safe-att-1",
            name: "untrusted.exe",
            mimeType: "image/x-unknown",
            sizeBytes: 5,
          },
          {
            type: "image",
            id: "thread-attachments-safe-att-2",
            name: "not-image.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ]);
      }),
    );
  },
);

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect(
    "passes explicit empty attachment arrays through the projection pipeline to clear attachments",
    () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = "2026-01-01T00:00:00.000Z";
        const later = "2026-01-01T00:00:01.000Z";

        yield* eventStore.append({
          type: "project.created",
          eventId: EventId.make("evt-clear-attachments-1"),
          aggregateKind: "project",
          aggregateId: ProjectId.make("project-clear-attachments"),
          occurredAt: now,
          commandId: CommandId.make("cmd-clear-attachments-1"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-clear-attachments-1"),
          metadata: {},
          payload: {
            projectId: ProjectId.make("project-clear-attachments"),
            title: "Project Clear Attachments",
            workspaceRoot: "/tmp/project-clear-attachments",
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.created",
          eventId: EventId.make("evt-clear-attachments-2"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-clear-attachments"),
          occurredAt: now,
          commandId: CommandId.make("cmd-clear-attachments-2"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-clear-attachments-2"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-clear-attachments"),
            projectId: ProjectId.make("project-clear-attachments"),
            title: "Thread Clear Attachments",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.make("evt-clear-attachments-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-clear-attachments"),
          occurredAt: now,
          commandId: CommandId.make("cmd-clear-attachments-3"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-clear-attachments-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-clear-attachments"),
            messageId: MessageId.make("message-clear-attachments"),
            role: "user",
            text: "Has attachments",
            attachments: [
              {
                type: "image",
                id: "thread-clear-attachments-att-1",
                name: "clear.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.make("evt-clear-attachments-4"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-clear-attachments"),
          occurredAt: later,
          commandId: CommandId.make("cmd-clear-attachments-4"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-clear-attachments-4"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-clear-attachments"),
            messageId: MessageId.make("message-clear-attachments"),
            role: "user",
            text: "",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: later,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
          SELECT
            attachments_json AS "attachmentsJson"
          FROM projection_thread_messages
          WHERE message_id = 'message-clear-attachments'
        `;
        assert.equal(rows.length, 1);
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), []);
      }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-overwrite-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("overwrites stored attachment references when a message updates attachments", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";
      const later = "2026-01-01T00:00:01.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-overwrite-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-overwrite"),
        occurredAt: now,
        commandId: CommandId.make("cmd-overwrite-1"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-overwrite-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-overwrite"),
          title: "Project Overwrite",
          workspaceRoot: "/tmp/project-overwrite",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-overwrite-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-overwrite"),
        occurredAt: now,
        commandId: CommandId.make("cmd-overwrite-2"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-overwrite-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-overwrite"),
          projectId: ProjectId.make("project-overwrite"),
          title: "Thread Overwrite",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-overwrite-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-overwrite"),
        occurredAt: now,
        commandId: CommandId.make("cmd-overwrite-3"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-overwrite-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-overwrite"),
          messageId: MessageId.make("message-overwrite"),
          role: "user",
          text: "first image",
          attachments: [
            {
              type: "image",
              id: "thread-overwrite-att-1",
              name: "file.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-overwrite-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-overwrite"),
        occurredAt: later,
        commandId: CommandId.make("cmd-overwrite-4"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-overwrite-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-overwrite"),
          messageId: MessageId.make("message-overwrite"),
          role: "user",
          text: "",
          attachments: [
            {
              type: "image",
              id: "thread-overwrite-att-2",
              name: "file.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: later,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly attachmentsJson: string | null;
      }>`
              SELECT attachments_json AS "attachmentsJson"
              FROM projection_thread_messages
              WHERE message_id = 'message-overwrite'
            `;
      assert.equal(rows.length, 1);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
        {
          type: "image",
          id: "thread-overwrite-att-2",
          name: "file.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ]);
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-rollback-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("does not persist attachment files when projector transaction rolls back", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const path = yield* Path.Path;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.make("evt-rollback-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-rollback"),
        occurredAt: now,
        commandId: CommandId.make("cmd-rollback-1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-rollback-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-rollback"),
          title: "Project Rollback",
          workspaceRoot: "/tmp/project-rollback",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.make("evt-rollback-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-rollback"),
        occurredAt: now,
        commandId: CommandId.make("cmd-rollback-2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-rollback-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-rollback"),
          projectId: ProjectId.make("project-rollback"),
          title: "Thread Rollback",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* sql`
        CREATE TRIGGER fail_thread_messages_projection_state_update
        BEFORE UPDATE ON projection_state
        WHEN NEW.projector = 'projection.thread-messages'
        BEGIN
          SELECT RAISE(ABORT, 'forced-projection-state-failure');
        END;
      `;

      const result = yield* Effect.result(
        appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.make("evt-rollback-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-rollback"),
          occurredAt: now,
          commandId: CommandId.make("cmd-rollback-3"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-rollback-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-rollback"),
            messageId: MessageId.make("message-rollback"),
            role: "user",
            text: "Rollback me",
            attachments: [
              {
                type: "image",
                id: "thread-rollback-att-1",
                name: "rollback.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      assert.equal(result._tag, "Failure");

      const rows = yield* sql<{
        readonly count: number;
      }>`
        SELECT COUNT(*) AS "count"
        FROM projection_thread_messages
        WHERE message_id = 'message-rollback'
      `;
      assert.equal(rows[0]?.count ?? 0, 0);

      const { attachmentsDir } = yield* ServerConfig;
      const attachmentPath = path.join(attachmentsDir, "thread-rollback-att-1.png");
      assert.isFalse(yield* exists(attachmentPath));
      yield* sql`DROP TRIGGER IF EXISTS fail_thread_messages_projection_state_update`;
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-overwrite-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("removes unreferenced attachment files when a thread is reverted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const { attachmentsDir } = yield* ServerConfig;
      const now = "2026-01-01T00:00:00.000Z";
      const threadId = ThreadId.make("Thread Revert.Files");
      const keepAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000001";
      const removeAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000002";
      const otherThreadAttachmentId =
        "thread-revert-files-extra-00000000-0000-4000-8000-000000000003";

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.make("evt-revert-files-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-revert-files"),
        occurredAt: now,
        commandId: CommandId.make("cmd-revert-files-1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-files-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-revert-files"),
          title: "Project Revert Files",
          workspaceRoot: "/tmp/project-revert-files",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.make("evt-revert-files-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-revert-files-2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-files-2"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.make("project-revert-files"),
          title: "Thread Revert Files",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.make("evt-revert-files-3"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-revert-files-3"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-files-3"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.make("turn-keep"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-revert-files/turn/1"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.make("message-keep"),
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.make("evt-revert-files-4"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-revert-files-4"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-files-4"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.make("message-keep"),
          role: "assistant",
          text: "Keep",
          attachments: [
            {
              type: "image",
              id: keepAttachmentId,
              name: "keep.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: TurnId.make("turn-keep"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.make("evt-revert-files-5"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-revert-files-5"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-files-5"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.make("turn-remove"),
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-revert-files/turn/2"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.make("message-remove"),
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.make("evt-revert-files-6"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-revert-files-6"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-files-6"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.make("message-remove"),
          role: "assistant",
          text: "Remove",
          attachments: [
            {
              type: "image",
              id: removeAttachmentId,
              name: "remove.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: TurnId.make("turn-remove"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      const keepPath = path.join(attachmentsDir, `${keepAttachmentId}.png`);
      const removePath = path.join(attachmentsDir, `${removeAttachmentId}.png`);
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(keepPath, "keep");
      yield* fileSystem.writeFileString(removePath, "remove");
      const otherThreadPath = path.join(attachmentsDir, `${otherThreadAttachmentId}.png`);
      yield* fileSystem.writeFileString(otherThreadPath, "other");
      assert.isTrue(yield* exists(keepPath));
      assert.isTrue(yield* exists(removePath));
      assert.isTrue(yield* exists(otherThreadPath));

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: EventId.make("evt-revert-files-7"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-revert-files-7"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-files-7"),
        metadata: {},
        payload: {
          threadId,
          turnCount: 1,
        },
      });

      assert.isTrue(yield* exists(keepPath));
      assert.isFalse(yield* exists(removePath));
      assert.isTrue(yield* exists(otherThreadPath));
    }),
  );
});

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-revert-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("removes thread attachment directory when thread is deleted", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const { attachmentsDir } = yield* ServerConfig;
        const now = "2026-01-01T00:00:00.000Z";
        const threadId = ThreadId.make("Thread Delete.Files");
        const attachmentId = "thread-delete-files-00000000-0000-4000-8000-000000000001";
        const otherThreadAttachmentId =
          "thread-delete-files-extra-00000000-0000-4000-8000-000000000002";

        const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
          eventStore
            .append(event)
            .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

        yield* appendAndProject({
          type: "project.created",
          eventId: EventId.make("evt-delete-files-1"),
          aggregateKind: "project",
          aggregateId: ProjectId.make("project-delete-files"),
          occurredAt: now,
          commandId: CommandId.make("cmd-delete-files-1"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-delete-files-1"),
          metadata: {},
          payload: {
            projectId: ProjectId.make("project-delete-files"),
            title: "Project Delete Files",
            workspaceRoot: "/tmp/project-delete-files",
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* appendAndProject({
          type: "thread.created",
          eventId: EventId.make("evt-delete-files-2"),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.make("cmd-delete-files-2"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-delete-files-2"),
          metadata: {},
          payload: {
            threadId,
            projectId: ProjectId.make("project-delete-files"),
            title: "Thread Delete Files",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.make("evt-delete-files-3"),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.make("cmd-delete-files-3"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-delete-files-3"),
          metadata: {},
          payload: {
            threadId,
            messageId: MessageId.make("message-delete-files"),
            role: "user",
            text: "Delete",
            attachments: [
              {
                type: "image",
                id: attachmentId,
                name: "delete.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        const threadAttachmentPath = path.join(attachmentsDir, `${attachmentId}.png`);
        const otherThreadAttachmentPath = path.join(
          attachmentsDir,
          `${otherThreadAttachmentId}.png`,
        );
        yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
        yield* fileSystem.writeFileString(threadAttachmentPath, "delete");
        yield* fileSystem.writeFileString(otherThreadAttachmentPath, "other-thread");
        assert.isTrue(yield* exists(threadAttachmentPath));
        assert.isTrue(yield* exists(otherThreadAttachmentPath));

        yield* appendAndProject({
          type: "thread.deleted",
          eventId: EventId.make("evt-delete-files-4"),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.make("cmd-delete-files-4"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-delete-files-4"),
          metadata: {},
          payload: {
            threadId,
            deletedAt: now,
          },
        });

        assert.isFalse(yield* exists(threadAttachmentPath));
        assert.isTrue(yield* exists(otherThreadAttachmentPath));
      }),
    );
  },
);

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-delete-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("ignores unsafe thread ids for attachment cleanup paths", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const now = "2026-01-01T00:00:00.000Z";
        const { attachmentsDir: attachmentsRootDir, stateDir } = yield* ServerConfig;
        const attachmentsSentinelPath = path.join(attachmentsRootDir, "sentinel.txt");
        const stateDirSentinelPath = path.join(stateDir, "state-sentinel.txt");
        yield* fileSystem.makeDirectory(attachmentsRootDir, { recursive: true });
        yield* fileSystem.writeFileString(attachmentsSentinelPath, "keep-attachments-root");
        yield* fileSystem.writeFileString(stateDirSentinelPath, "keep-state-dir");

        yield* eventStore.append({
          type: "thread.deleted",
          eventId: EventId.make("evt-unsafe-thread-delete"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make(".."),
          occurredAt: now,
          commandId: CommandId.make("cmd-unsafe-thread-delete"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-unsafe-thread-delete"),
          metadata: {},
          payload: {
            threadId: ThreadId.make(".."),
            deletedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        assert.isTrue(yield* exists(attachmentsRootDir));
        assert.isTrue(yield* exists(attachmentsSentinelPath));
        assert.isTrue(yield* exists(stateDirSentinelPath));
      }),
    );
  },
);

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect("resumes from projector last_applied_sequence without replaying older events", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-a1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-a"),
        occurredAt: now,
        commandId: CommandId.make("cmd-a1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-a1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-a"),
          title: "Project A",
          workspaceRoot: "/tmp/project-a",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-a2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-a"),
        occurredAt: now,
        commandId: CommandId.make("cmd-a2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-a2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-a"),
          projectId: ProjectId.make("project-a"),
          title: "Thread A",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-a3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-a"),
        occurredAt: now,
        commandId: CommandId.make("cmd-a3"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-a3"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-a"),
          messageId: MessageId.make("message-a"),
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-a4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-a"),
        occurredAt: now,
        commandId: CommandId.make("cmd-a4"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-a4"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-a"),
          messageId: MessageId.make("message-a"),
          role: "assistant",
          text: " world",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;
      yield* projectionPipeline.bootstrap;

      const messageRows = yield* sql<{ readonly text: string }>`
        SELECT text FROM projection_thread_messages WHERE message_id = 'message-a'
      `;
      assert.deepEqual(messageRows, [{ text: "hello world" }]);

      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
      `;
      const maxSequenceRows = yield* sql<{ readonly maxSequence: number }>`
        SELECT MAX(sequence) AS "maxSequence" FROM orchestration_events
      `;
      const maxSequence = maxSequenceRows[0]?.maxSequence ?? 0;
      for (const row of stateRows) {
        assert.equal(row.lastAppliedSequence, maxSequence);
      }
    }),
  );

  it.effect("keeps the turn running across interim assistant messages until the session ends", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";
      const threadId = ThreadId.make("thread-turn-lifecycle");
      const turnId = TurnId.make("turn-lifecycle-1");

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-tl1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-tl1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-tl1"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.make("project-turn-lifecycle"),
          title: "Turn lifecycle",
          modelSelection: {
            instanceId: ProviderInstanceId.make("claude"),
            model: "claude-opus",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.make("evt-tl2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:01.000Z",
        commandId: CommandId.make("cmd-tl2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-tl2"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "claude",
            runtimeMode: "full-access",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-tl3"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:05.000Z",
        commandId: CommandId.make("cmd-tl3"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-tl3"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.make("message-tl-interim"),
          role: "assistant",
          text: "interim commentary",
          turnId,
          streaming: false,
          createdAt: "2026-01-01T00:00:05.000Z",
          updatedAt: "2026-01-01T00:00:05.000Z",
        },
      });

      yield* projectionPipeline.bootstrap;

      const runningRows = yield* sql<{
        readonly state: string;
        readonly completedAt: string | null;
      }>`
        SELECT state, completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId} AND turn_id = ${turnId}
      `;
      assert.deepEqual(runningRows, [{ state: "running", completedAt: null }]);

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.make("evt-tl4"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:01:00.000Z",
        commandId: CommandId.make("cmd-tl4"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-tl4"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "claude",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-01-01T00:01:00.000Z",
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const settledRows = yield* sql<{
        readonly state: string;
        readonly completedAt: string | null;
      }>`
        SELECT state, completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId} AND turn_id = ${turnId}
      `;
      assert.deepEqual(settledRows, [
        { state: "completed", completedAt: "2026-01-01T00:01:00.000Z" },
      ]);
    }),
  );

  it.effect("settles a superseded running turn when a new turn becomes active", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";
      const threadId = ThreadId.make("thread-turn-supersede");
      const oldTurnId = TurnId.make("turn-superseded");
      const newTurnId = TurnId.make("turn-steer");

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-ts1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-ts1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-ts1"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.make("project-turn-supersede"),
          title: "Turn supersede",
          modelSelection: {
            instanceId: ProviderInstanceId.make("opencode"),
            model: "big-pickle",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const appendRunningSessionSet = (eventId: string, turnId: TurnId, updatedAt: string) =>
        eventStore.append({
          type: "thread.session-set",
          eventId: EventId.make(eventId),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: updatedAt,
          commandId: CommandId.make(`cmd-${eventId}`),
          causationEventId: null,
          correlationId: CorrelationId.make(`cmd-${eventId}`),
          metadata: {},
          payload: {
            threadId,
            session: {
              threadId,
              status: "running",
              providerName: "opencode",
              runtimeMode: "full-access",
              activeTurnId: turnId,
              lastError: null,
              updatedAt,
            },
          },
        });

      yield* appendRunningSessionSet("evt-ts2", oldTurnId, "2026-01-01T00:00:01.000Z");
      yield* appendRunningSessionSet("evt-ts3", newTurnId, "2026-01-01T00:00:30.000Z");

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly turnId: string;
        readonly state: string;
        readonly completedAt: string | null;
      }>`
        SELECT turn_id AS "turnId", state, completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
        ORDER BY requested_at
      `;
      assert.deepEqual(rows, [
        {
          turnId: oldTurnId,
          state: "completed",
          completedAt: "2026-01-01T00:00:30.000Z",
        },
        { turnId: newTurnId, state: "running", completedAt: null },
      ]);
    }),
  );

  it.effect("keeps accumulated assistant text when completion payload text is empty", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-empty-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-empty"),
        occurredAt: now,
        commandId: CommandId.make("cmd-empty-1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-empty-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-empty"),
          title: "Project Empty",
          workspaceRoot: "/tmp/project-empty",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-empty-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-empty"),
        occurredAt: now,
        commandId: CommandId.make("cmd-empty-2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-empty-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-empty"),
          projectId: ProjectId.make("project-empty"),
          title: "Thread Empty",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-empty-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-empty"),
        occurredAt: now,
        commandId: CommandId.make("cmd-empty-3"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-empty-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-empty"),
          messageId: MessageId.make("assistant-empty"),
          role: "assistant",
          text: "Hello",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-empty-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-empty"),
        occurredAt: now,
        commandId: CommandId.make("cmd-empty-4"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-empty-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-empty"),
          messageId: MessageId.make("assistant-empty"),
          role: "assistant",
          text: " world",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.make("evt-empty-5"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-empty"),
        occurredAt: now,
        commandId: CommandId.make("cmd-empty-5"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-empty-5"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-empty"),
          messageId: MessageId.make("assistant-empty"),
          role: "assistant",
          text: "",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      const messageRows = yield* sql<{
        readonly text: string;
        readonly isStreaming: unknown;
      }>`
        SELECT
          text,
          is_streaming AS "isStreaming"
        FROM projection_thread_messages
        WHERE message_id = 'assistant-empty'
      `;
      assert.equal(messageRows.length, 1);
      assert.equal(messageRows[0]?.text, "Hello world");
      assert.isFalse(Boolean(messageRows[0]?.isStreaming));
    }),
  );

  it.effect(
    "resolves turn-count conflicts when checkpoint completion rewrites provisional turns",
    () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
          eventStore
            .append(event)
            .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

        yield* appendAndProject({
          type: "project.created",
          eventId: EventId.make("evt-conflict-1"),
          aggregateKind: "project",
          aggregateId: ProjectId.make("project-conflict"),
          occurredAt: "2026-02-26T13:00:00.000Z",
          commandId: CommandId.make("cmd-conflict-1"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-conflict-1"),
          metadata: {},
          payload: {
            projectId: ProjectId.make("project-conflict"),
            title: "Project Conflict",
            workspaceRoot: "/tmp/project-conflict",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-02-26T13:00:00.000Z",
            updatedAt: "2026-02-26T13:00:00.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.created",
          eventId: EventId.make("evt-conflict-2"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-conflict"),
          occurredAt: "2026-02-26T13:00:01.000Z",
          commandId: CommandId.make("cmd-conflict-2"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-conflict-2"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-conflict"),
            projectId: ProjectId.make("project-conflict"),
            title: "Thread Conflict",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: "2026-02-26T13:00:01.000Z",
            updatedAt: "2026-02-26T13:00:01.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-interrupt-requested",
          eventId: EventId.make("evt-conflict-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-conflict"),
          occurredAt: "2026-02-26T13:00:02.000Z",
          commandId: CommandId.make("cmd-conflict-3"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-conflict-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-conflict"),
            turnId: TurnId.make("turn-interrupted"),
            createdAt: "2026-02-26T13:00:02.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.make("evt-conflict-4"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-conflict"),
          occurredAt: "2026-02-26T13:00:03.000Z",
          commandId: CommandId.make("cmd-conflict-4"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-conflict-4"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-conflict"),
            messageId: MessageId.make("assistant-conflict"),
            role: "assistant",
            text: "done",
            turnId: TurnId.make("turn-completed"),
            streaming: false,
            createdAt: "2026-02-26T13:00:03.000Z",
            updatedAt: "2026-02-26T13:00:03.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-diff-completed",
          eventId: EventId.make("evt-conflict-5"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-conflict"),
          occurredAt: "2026-02-26T13:00:04.000Z",
          commandId: CommandId.make("cmd-conflict-5"),
          causationEventId: null,
          correlationId: CorrelationId.make("cmd-conflict-5"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-conflict"),
            turnId: TurnId.make("turn-completed"),
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-conflict/turn/1"),
            status: "ready",
            files: [],
            assistantMessageId: MessageId.make("assistant-conflict"),
            completedAt: "2026-02-26T13:00:04.000Z",
          },
        });

        const turnRows = yield* sql<{
          readonly turnId: string;
          readonly checkpointTurnCount: number | null;
          readonly status: string;
        }>`
        SELECT
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          state AS "status"
        FROM projection_turns
        WHERE thread_id = 'thread-conflict'
        ORDER BY
          CASE
            WHEN checkpoint_turn_count IS NULL THEN 1
            ELSE 0
          END ASC,
          checkpoint_turn_count ASC,
          requested_at ASC
      `;
        assert.deepEqual(turnRows, [
          {
            turnId: "turn-completed",
            checkpointTurnCount: 1,
            status: "completed",
          },
          {
            turnId: "turn-interrupted",
            checkpointTurnCount: null,
            status: "interrupted",
          },
        ]);
      }),
  );

  it.effect("clears stale pending approvals from projected shell summaries", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.make("evt-stale-approval-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-stale-approval"),
        occurredAt: "2026-02-26T12:30:00.000Z",
        commandId: CommandId.make("cmd-stale-approval-1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stale-approval-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-stale-approval"),
          title: "Project Stale Approval",
          workspaceRoot: "/tmp/project-stale-approval",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-02-26T12:30:00.000Z",
          updatedAt: "2026-02-26T12:30:00.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.make("evt-stale-approval-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-stale-approval"),
        occurredAt: "2026-02-26T12:30:01.000Z",
        commandId: CommandId.make("cmd-stale-approval-2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stale-approval-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-stale-approval"),
          projectId: ProjectId.make("project-stale-approval"),
          title: "Thread Stale Approval",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-02-26T12:30:01.000Z",
          updatedAt: "2026-02-26T12:30:01.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.activity-appended",
        eventId: EventId.make("evt-stale-approval-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-stale-approval"),
        occurredAt: "2026-02-26T12:30:02.000Z",
        commandId: CommandId.make("cmd-stale-approval-3"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stale-approval-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-stale-approval"),
          activity: {
            id: EventId.make("activity-stale-approval-requested"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Command approval requested",
            payload: {
              requestId: "approval-request-stale-1",
              requestKind: "command",
            },
            turnId: null,
            createdAt: "2026-02-26T12:30:02.000Z",
          },
        },
      });

      yield* appendAndProject({
        type: "thread.activity-appended",
        eventId: EventId.make("evt-stale-approval-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-stale-approval"),
        occurredAt: "2026-02-26T12:30:03.000Z",
        commandId: CommandId.make("cmd-stale-approval-4"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-stale-approval-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-stale-approval"),
          activity: {
            id: EventId.make("activity-stale-approval-failed"),
            tone: "error",
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            payload: {
              requestId: "approval-request-stale-1",
              detail: "Unknown pending permission request: approval-request-stale-1",
            },
            turnId: null,
            createdAt: "2026-02-26T12:30:03.000Z",
          },
        },
      });

      const approvalRows = yield* sql<{
        readonly requestId: string;
        readonly status: string;
        readonly resolvedAt: string | null;
      }>`
        SELECT
          request_id AS "requestId",
          status,
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE request_id = 'approval-request-stale-1'
      `;
      assert.deepEqual(approvalRows, [
        {
          requestId: "approval-request-stale-1",
          status: "resolved",
          resolvedAt: "2026-02-26T12:30:03.000Z",
        },
      ]);

      const threadRows = yield* sql<{
        readonly pendingApprovalCount: number;
      }>`
        SELECT pending_approval_count AS "pendingApprovalCount"
        FROM projection_threads
        WHERE thread_id = 'thread-stale-approval'
      `;
      assert.deepEqual(threadRows, [{ pendingApprovalCount: 0 }]);
    }),
  );

  it.effect("ignores non-stale provider approval response failures", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.make("evt-nonstale-approval-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-nonstale-approval"),
        occurredAt: "2026-02-26T12:45:00.000Z",
        commandId: CommandId.make("cmd-nonstale-approval-1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-nonstale-approval-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-nonstale-approval"),
          title: "Project Non-Stale Approval",
          workspaceRoot: "/tmp/project-nonstale-approval",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-02-26T12:45:00.000Z",
          updatedAt: "2026-02-26T12:45:00.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.make("evt-nonstale-approval-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-nonstale-approval"),
        occurredAt: "2026-02-26T12:45:01.000Z",
        commandId: CommandId.make("cmd-nonstale-approval-2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-nonstale-approval-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-nonstale-approval"),
          projectId: ProjectId.make("project-nonstale-approval"),
          title: "Thread Non-Stale Approval",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-02-26T12:45:01.000Z",
          updatedAt: "2026-02-26T12:45:01.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.activity-appended",
        eventId: EventId.make("evt-nonstale-approval-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-nonstale-approval"),
        occurredAt: "2026-02-26T12:45:02.000Z",
        commandId: CommandId.make("cmd-nonstale-approval-3"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-nonstale-approval-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-nonstale-approval"),
          activity: {
            id: EventId.make("activity-nonstale-approval-requested"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Command approval requested",
            payload: {
              requestId: "approval-request-nonstale-existing",
              requestKind: "command",
            },
            turnId: null,
            createdAt: "2026-02-26T12:45:02.000Z",
          },
        },
      });

      yield* appendAndProject({
        type: "thread.activity-appended",
        eventId: EventId.make("evt-nonstale-approval-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-nonstale-approval"),
        occurredAt: "2026-02-26T12:45:03.000Z",
        commandId: CommandId.make("cmd-nonstale-approval-4"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-nonstale-approval-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-nonstale-approval"),
          activity: {
            id: EventId.make("activity-nonstale-approval-failed-existing"),
            tone: "error",
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            payload: {
              requestId: "approval-request-nonstale-existing",
              detail: "Provider timed out while responding to approval request",
            },
            turnId: TurnId.make("turn-nonstale-failure"),
            createdAt: "2026-02-26T12:45:03.000Z",
          },
        },
      });

      yield* appendAndProject({
        type: "thread.activity-appended",
        eventId: EventId.make("evt-nonstale-approval-5"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-nonstale-approval"),
        occurredAt: "2026-02-26T12:45:04.000Z",
        commandId: CommandId.make("cmd-nonstale-approval-5"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-nonstale-approval-5"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-nonstale-approval"),
          activity: {
            id: EventId.make("activity-nonstale-approval-failed-missing"),
            tone: "error",
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            payload: {
              requestId: "approval-request-nonstale-missing",
              detail: "Provider timed out while responding to approval request",
            },
            turnId: null,
            createdAt: "2026-02-26T12:45:04.000Z",
          },
        },
      });

      const approvalRows = yield* sql<{
        readonly requestId: string;
        readonly status: string;
        readonly turnId: string | null;
        readonly createdAt: string;
        readonly resolvedAt: string | null;
      }>`
        SELECT
          request_id AS "requestId",
          status,
          turn_id AS "turnId",
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE request_id IN (
          'approval-request-nonstale-existing',
          'approval-request-nonstale-missing'
        )
        ORDER BY request_id
      `;
      assert.deepEqual(approvalRows, [
        {
          requestId: "approval-request-nonstale-existing",
          status: "pending",
          turnId: null,
          createdAt: "2026-02-26T12:45:02.000Z",
          resolvedAt: null,
        },
      ]);

      const threadRows = yield* sql<{
        readonly pendingApprovalCount: number;
      }>`
        SELECT pending_approval_count AS "pendingApprovalCount"
        FROM projection_threads
        WHERE thread_id = 'thread-nonstale-approval'
      `;
      assert.deepEqual(threadRows, [{ pendingApprovalCount: 1 }]);
    }),
  );

  it.effect("does not fallback-retain messages whose turnId is removed by revert", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.make("evt-revert-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-revert"),
        occurredAt: "2026-02-26T12:00:00.000Z",
        commandId: CommandId.make("cmd-revert-1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-revert"),
          title: "Project Revert",
          workspaceRoot: "/tmp/project-revert",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-02-26T12:00:00.000Z",
          updatedAt: "2026-02-26T12:00:00.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.make("evt-revert-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-revert"),
        occurredAt: "2026-02-26T12:00:01.000Z",
        commandId: CommandId.make("cmd-revert-2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-revert"),
          projectId: ProjectId.make("project-revert"),
          title: "Thread Revert",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: "2026-02-26T12:00:01.000Z",
          updatedAt: "2026-02-26T12:00:01.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.make("evt-revert-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-revert"),
        occurredAt: "2026-02-26T12:00:02.000Z",
        commandId: CommandId.make("cmd-revert-3"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-revert"),
          turnId: TurnId.make("turn-1"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-revert/turn/1"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.make("assistant-keep"),
          completedAt: "2026-02-26T12:00:02.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.make("evt-revert-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-revert"),
        occurredAt: "2026-02-26T12:00:02.100Z",
        commandId: CommandId.make("cmd-revert-4"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-revert"),
          messageId: MessageId.make("assistant-keep"),
          role: "assistant",
          text: "kept",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-02-26T12:00:02.100Z",
          updatedAt: "2026-02-26T12:00:02.100Z",
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.make("evt-revert-5"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-revert"),
        occurredAt: "2026-02-26T12:00:03.000Z",
        commandId: CommandId.make("cmd-revert-5"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-5"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-revert"),
          turnId: TurnId.make("turn-2"),
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-revert/turn/2"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.make("assistant-remove"),
          completedAt: "2026-02-26T12:00:03.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.make("evt-revert-6"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-revert"),
        occurredAt: "2026-02-26T12:00:03.050Z",
        commandId: CommandId.make("cmd-revert-6"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-6"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-revert"),
          messageId: MessageId.make("user-remove"),
          role: "user",
          text: "removed",
          turnId: TurnId.make("turn-2"),
          streaming: false,
          createdAt: "2026-02-26T12:00:03.050Z",
          updatedAt: "2026-02-26T12:00:03.050Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.make("evt-revert-7"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-revert"),
        occurredAt: "2026-02-26T12:00:03.100Z",
        commandId: CommandId.make("cmd-revert-7"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-7"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-revert"),
          messageId: MessageId.make("assistant-remove"),
          role: "assistant",
          text: "removed",
          turnId: TurnId.make("turn-2"),
          streaming: false,
          createdAt: "2026-02-26T12:00:03.100Z",
          updatedAt: "2026-02-26T12:00:03.100Z",
        },
      });

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: EventId.make("evt-revert-8"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-revert"),
        occurredAt: "2026-02-26T12:00:04.000Z",
        commandId: CommandId.make("cmd-revert-8"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-revert-8"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-revert"),
          turnCount: 1,
        },
      });

      const messageRows = yield* sql<{
        readonly messageId: string;
        readonly turnId: string | null;
        readonly role: string;
      }>`
        SELECT
          message_id AS "messageId",
          turn_id AS "turnId",
          role
        FROM projection_thread_messages
        WHERE thread_id = 'thread-revert'
        ORDER BY created_at ASC, message_id ASC
      `;
      assert.deepEqual(messageRows, [
        {
          messageId: "assistant-keep",
          turnId: "turn-1",
          role: "assistant",
        },
      ]);
    }),
  );
});

it.effect("restores pending turn-start metadata across projection pipeline restart", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const firstProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const secondProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );

    const threadId = ThreadId.make("thread-restart");
    const turnId = TurnId.make("turn-restart");
    const messageId = MessageId.make("message-restart");
    const sourcePlanThreadId = ThreadId.make("thread-plan-source");
    const sourcePlanId = "plan-source";
    const turnStartedAt = "2026-02-26T14:00:00.000Z";
    const sessionSetAt = "2026-02-26T14:00:05.000Z";

    yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: EventId.make("evt-restart-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: turnStartedAt,
        commandId: CommandId.make("cmd-restart-1"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-restart-1"),
        metadata: {},
        payload: {
          threadId,
          messageId,
          sourceProposedPlan: {
            threadId: sourcePlanThreadId,
            planId: sourcePlanId,
          },
          runtimeMode: "approval-required",
          createdAt: turnStartedAt,
        },
      });

      yield* projectionPipeline.bootstrap;
    }).pipe(Effect.provide(firstProjectionLayer));

    const turnRows = yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.make("evt-restart-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: sessionSetAt,
        commandId: CommandId.make("cmd-restart-2"),
        causationEventId: null,
        correlationId: CorrelationId.make("cmd-restart-2"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: sessionSetAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const pendingRows = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
      `;
      assert.deepEqual(pendingRows, []);

      return yield* sql<{
        readonly turnId: string;
        readonly userMessageId: string | null;
        readonly sourceProposedPlanThreadId: string | null;
        readonly sourceProposedPlanId: string | null;
        readonly startedAt: string;
      }>`
        SELECT
          turn_id AS "turnId",
          pending_message_id AS "userMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          started_at AS "startedAt"
        FROM projection_turns
        WHERE turn_id = ${turnId}
      `;
    }).pipe(Effect.provide(secondProjectionLayer));

    assert.deepEqual(turnRows, [
      {
        turnId: "turn-restart",
        userMessageId: "message-restart",
        sourceProposedPlanThreadId: "thread-plan-source",
        sourceProposedPlanId: "plan-source",
        startedAt: turnStartedAt,
      },
    ]);
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-projection-pipeline-restart-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

const engineLayer = it.layer(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolverLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-projection-pipeline-engine-dispatch-",
      }),
    ),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  ),
);

engineLayer("OrchestrationProjectionPipeline via engine dispatch", (it) => {
  it.effect("projects dispatched engine events immediately", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-01-01T00:00:00.000Z";

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-live-project"),
        projectId: ProjectId.make("project-live"),
        title: "Live Project",
        workspaceRoot: "/tmp/project-live",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      });

      const projectRows = yield* sql<{
        readonly title: string;
        readonly scriptsJson: string;
      }>`
        SELECT
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
        WHERE project_id = 'project-live'
      `;
      assert.deepEqual(projectRows, [{ title: "Live Project", scriptsJson: "[]" }]);

      const projectorRows = yield* sql<{
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector = 'projection.projects'
      `;
      assert.deepEqual(projectorRows, [{ lastAppliedSequence: 1 }]);
    }),
  );

  it.effect("projects persist updated scripts from project.meta.update", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-01-01T00:00:00.000Z";

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-scripts-project-create"),
        projectId: ProjectId.make("project-scripts"),
        title: "Scripts Project",
        workspaceRoot: "/tmp/project-scripts",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      });

      yield* engine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.make("cmd-scripts-project-update"),
        projectId: ProjectId.make("project-scripts"),
        scripts: [
          {
            id: "script-1",
            name: "Build",
            command: "bun run build",
            icon: "build",
            runOnWorktreeCreate: false,
          },
        ],
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5",
        },
      });

      const projectRows = yield* sql<{
        readonly scriptsJson: string;
        readonly defaultModelSelection: string;
      }>`
        SELECT
          scripts_json AS "scriptsJson",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-scripts'
      `;
      assert.deepEqual(projectRows, [
        {
          scriptsJson:
            '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          defaultModelSelection: '{"instanceId":"codex","model":"gpt-5"}',
        },
      ]);
    }),
  );
});

// ---------------------------------------------------------------------------
// Characterization test for thread-shell summary counters (plan 011)
// Drives a thread through a representative event sequence and asserts the
// exact values of all four refreshThreadShellSummary counters:
//   latestUserMessageAt, pendingApprovalCount, pendingUserInputCount,
//   hasActionableProposedPlan
// This MUST pass against the current code before the optimisation lands.
// ---------------------------------------------------------------------------
it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-shell-summary-counters-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect(
      "refreshThreadShellSummary: computes all four counters correctly after a representative event sequence",
      () =>
        Effect.gen(function* () {
          const projectionPipeline = yield* OrchestrationProjectionPipeline;
          const eventStore = yield* OrchestrationEventStore;
          const sql = yield* SqlClient.SqlClient;

          const t0 = "2026-01-01T00:00:00.000Z";
          const t1 = "2026-01-01T00:00:01.000Z";
          const t2 = "2026-01-01T00:00:02.000Z";
          const t3 = "2026-01-01T00:00:03.000Z";
          const t4 = "2026-01-01T00:00:04.000Z";
          const t5 = "2026-01-01T00:00:05.000Z";
          const t6 = "2026-01-01T00:00:06.000Z";
          const t7 = "2026-01-01T00:00:07.000Z";
          const t8 = "2026-01-01T00:00:08.000Z";

          const projectId = ProjectId.make("project-shell-summary");
          const threadId = ThreadId.make("thread-shell-summary");
          const turnId = TurnId.make("turn-shell-summary-1");

          const reqIdUserInput1 = ApprovalRequestId.make("req-user-input-1");
          const reqIdUserInput2 = ApprovalRequestId.make("req-user-input-2");
          const reqIdApproval1 = ApprovalRequestId.make("req-approval-1");
          const reqIdApproval2 = ApprovalRequestId.make("req-approval-2");

          const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
            eventStore
              .append(event)
              .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

          const readShellSummary = sql<{
            readonly latestUserMessageAt: string | null;
            readonly pendingApprovalCount: number;
            readonly pendingUserInputCount: number;
            readonly hasActionableProposedPlan: number;
          }>`
          SELECT
            latest_user_message_at AS "latestUserMessageAt",
            pending_approval_count AS "pendingApprovalCount",
            pending_user_input_count AS "pendingUserInputCount",
            has_actionable_proposed_plan AS "hasActionableProposedPlan"
          FROM projection_threads
          WHERE thread_id = ${threadId}
        `;

          // --- Setup: project + thread ---
          yield* appendAndProject({
            type: "project.created",
            eventId: EventId.make("evt-ss-project"),
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: t0,
            commandId: CommandId.make("cmd-ss-project"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-project"),
            metadata: {},
            payload: {
              projectId,
              title: "Shell Summary Project",
              workspaceRoot: "/tmp/shell-summary",
              defaultModelSelection: null,
              scripts: [],
              createdAt: t0,
              updatedAt: t0,
            },
          });

          yield* appendAndProject({
            type: "thread.created",
            eventId: EventId.make("evt-ss-thread"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t0,
            commandId: CommandId.make("cmd-ss-thread"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-thread"),
            metadata: {},
            payload: {
              threadId,
              projectId,
              title: "Shell Summary Thread",
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5-codex",
              },
              runtimeMode: "full-access",
              branch: null,
              worktreePath: null,
              createdAt: t0,
              updatedAt: t0,
            },
          });

          // --- User message 1 (earlier) ---
          yield* appendAndProject({
            type: "thread.message-sent",
            eventId: EventId.make("evt-ss-user-msg-1"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t1,
            commandId: CommandId.make("cmd-ss-user-msg-1"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-user-msg-1"),
            metadata: {},
            payload: {
              threadId,
              messageId: MessageId.make("msg-ss-user-1"),
              role: "user",
              text: "First user message",
              turnId,
              streaming: false,
              createdAt: t1,
              updatedAt: t1,
            },
          });

          // --- Assistant message (does not affect latestUserMessageAt) ---
          yield* appendAndProject({
            type: "thread.message-sent",
            eventId: EventId.make("evt-ss-asst-msg-1"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t2,
            commandId: CommandId.make("cmd-ss-asst-msg-1"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-asst-msg-1"),
            metadata: {},
            payload: {
              threadId,
              messageId: MessageId.make("msg-ss-asst-1"),
              role: "assistant",
              text: "First assistant reply",
              turnId,
              streaming: false,
              createdAt: t2,
              updatedAt: t2,
            },
          });

          // --- User message 2 (later — this should become latestUserMessageAt) ---
          yield* appendAndProject({
            type: "thread.message-sent",
            eventId: EventId.make("evt-ss-user-msg-2"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t3,
            commandId: CommandId.make("cmd-ss-user-msg-2"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-user-msg-2"),
            metadata: {},
            payload: {
              threadId,
              messageId: MessageId.make("msg-ss-user-2"),
              role: "user",
              text: "Second user message",
              turnId,
              streaming: false,
              createdAt: t3,
              updatedAt: t3,
            },
          });

          // After 2 user messages: latestUserMessageAt=t3, all counters still 0
          const afterUserMsgs = yield* readShellSummary;
          assert.equal(afterUserMsgs[0]?.latestUserMessageAt, t3);
          assert.equal(afterUserMsgs[0]?.pendingApprovalCount, 0);
          assert.equal(afterUserMsgs[0]?.pendingUserInputCount, 0);
          assert.equal(afterUserMsgs[0]?.hasActionableProposedPlan, 0);

          // --- Activity: user-input.requested (opens a pending user-input) ---
          yield* appendAndProject({
            type: "thread.activity-appended",
            eventId: EventId.make("evt-ss-ui-req-1"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t4,
            commandId: CommandId.make("cmd-ss-ui-req-1"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-ui-req-1"),
            metadata: {},
            payload: {
              threadId,
              activity: {
                id: EventId.make("evt-ss-ui-req-1"),
                tone: "info",
                kind: "user-input.requested",
                summary: "Input needed",
                payload: { requestId: reqIdUserInput1 },
                turnId,
                createdAt: t4,
              },
            },
          });

          // pendingUserInputCount should now be 1
          const afterUiReq1 = yield* readShellSummary;
          assert.equal(afterUiReq1[0]?.pendingUserInputCount, 1);
          assert.equal(afterUiReq1[0]?.pendingApprovalCount, 0);

          // --- Activity: user-input.resolved (closes that pending user-input) ---
          yield* appendAndProject({
            type: "thread.activity-appended",
            eventId: EventId.make("evt-ss-ui-res-1"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t4,
            commandId: CommandId.make("cmd-ss-ui-res-1"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-ui-res-1"),
            metadata: {},
            payload: {
              threadId,
              activity: {
                id: EventId.make("evt-ss-ui-res-1"),
                tone: "info",
                kind: "user-input.resolved",
                summary: "Input provided",
                payload: { requestId: reqIdUserInput1 },
                turnId,
                createdAt: t4,
              },
            },
          });

          // pendingUserInputCount back to 0
          const afterUiRes1 = yield* readShellSummary;
          assert.equal(afterUiRes1[0]?.pendingUserInputCount, 0);

          // --- Activity: user-input.requested again (stays open) ---
          yield* appendAndProject({
            type: "thread.activity-appended",
            eventId: EventId.make("evt-ss-ui-req-2"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t5,
            commandId: CommandId.make("cmd-ss-ui-req-2"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-ui-req-2"),
            metadata: {},
            payload: {
              threadId,
              activity: {
                id: EventId.make("evt-ss-ui-req-2"),
                tone: "info",
                kind: "user-input.requested",
                summary: "More input needed",
                payload: { requestId: reqIdUserInput2 },
                turnId,
                createdAt: t5,
              },
            },
          });

          // pendingUserInputCount = 1 (stays open)
          const afterUiReq2 = yield* readShellSummary;
          assert.equal(afterUiReq2[0]?.pendingUserInputCount, 1);

          // --- Activity: approval.requested (creates pending approval #1) ---
          yield* appendAndProject({
            type: "thread.activity-appended",
            eventId: EventId.make("evt-ss-apr-req-1"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t5,
            commandId: CommandId.make("cmd-ss-apr-req-1"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-apr-req-1"),
            metadata: { requestId: reqIdApproval1 },
            payload: {
              threadId,
              activity: {
                id: EventId.make("evt-ss-apr-req-1"),
                tone: "approval",
                kind: "approval.requested",
                summary: "Approval needed 1",
                payload: { requestId: reqIdApproval1 },
                turnId,
                createdAt: t5,
              },
            },
          });

          // pendingApprovalCount = 1
          const afterAprReq1 = yield* readShellSummary;
          assert.equal(afterAprReq1[0]?.pendingApprovalCount, 1);

          // --- Activity: approval.requested (creates pending approval #2) ---
          yield* appendAndProject({
            type: "thread.activity-appended",
            eventId: EventId.make("evt-ss-apr-req-2"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t6,
            commandId: CommandId.make("cmd-ss-apr-req-2"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-apr-req-2"),
            metadata: { requestId: reqIdApproval2 },
            payload: {
              threadId,
              activity: {
                id: EventId.make("evt-ss-apr-req-2"),
                tone: "approval",
                kind: "approval.requested",
                summary: "Approval needed 2",
                payload: { requestId: reqIdApproval2 },
                turnId,
                createdAt: t6,
              },
            },
          });

          // pendingApprovalCount = 2
          const afterAprReq2 = yield* readShellSummary;
          assert.equal(afterAprReq2[0]?.pendingApprovalCount, 2);

          // --- Resolve approval #1 via thread.approval-response-requested ---
          yield* appendAndProject({
            type: "thread.approval-response-requested",
            eventId: EventId.make("evt-ss-apr-res-1"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t7,
            commandId: CommandId.make("cmd-ss-apr-res-1"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-apr-res-1"),
            metadata: {},
            payload: {
              threadId,
              requestId: reqIdApproval1,
              decision: "accept",
              createdAt: t7,
            },
          });

          // pendingApprovalCount = 1 (approval #2 still pending)
          const afterAprRes1 = yield* readShellSummary;
          assert.equal(afterAprRes1[0]?.pendingApprovalCount, 1);
          assert.equal(afterAprRes1[0]?.pendingUserInputCount, 1);

          // --- Proposed plan upserted (implementedAt=null → actionable) ---
          yield* appendAndProject({
            type: "thread.proposed-plan-upserted",
            eventId: EventId.make("evt-ss-plan-1"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t8,
            commandId: CommandId.make("cmd-ss-plan-1"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-ss-plan-1"),
            metadata: {},
            payload: {
              threadId,
              proposedPlan: {
                id: "plan-shell-summary-1",
                turnId,
                planMarkdown: "## Plan\n\nDo things",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: t8,
                updatedAt: t8,
              },
            },
          });

          // hasActionableProposedPlan = 1 (unimplemented plan)
          const afterPlan = yield* readShellSummary;
          assert.equal(afterPlan[0]?.hasActionableProposedPlan, 1);

          // --- Final state: assert all four counters together ---
          const final = yield* readShellSummary;
          assert.equal(final[0]?.latestUserMessageAt, t3, "latestUserMessageAt");
          assert.equal(final[0]?.pendingApprovalCount, 1, "pendingApprovalCount");
          assert.equal(final[0]?.pendingUserInputCount, 1, "pendingUserInputCount");
          assert.equal(final[0]?.hasActionableProposedPlan, 1, "hasActionableProposedPlan");
        }),
    );

    it.effect(
      "refreshThreadShellSummary: user-input-response-requested event still produces correct pendingUserInputCount",
      () =>
        Effect.gen(function* () {
          const projectionPipeline = yield* OrchestrationProjectionPipeline;
          const eventStore = yield* OrchestrationEventStore;
          const sql = yield* SqlClient.SqlClient;

          const t0 = "2026-01-01T00:00:00.000Z";
          const t1 = "2026-01-01T00:00:01.000Z";
          const t2 = "2026-01-01T00:00:02.000Z";

          const projectId = ProjectId.make("project-uiresponse");
          const threadId = ThreadId.make("thread-uiresponse");
          const reqId = ApprovalRequestId.make("req-uiresponse-1");

          const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
            eventStore
              .append(event)
              .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

          const readCounters = sql<{
            readonly pendingUserInputCount: number;
            readonly pendingApprovalCount: number;
          }>`
          SELECT
            pending_user_input_count AS "pendingUserInputCount",
            pending_approval_count AS "pendingApprovalCount"
          FROM projection_threads
          WHERE thread_id = ${threadId}
        `;

          yield* appendAndProject({
            type: "project.created",
            eventId: EventId.make("evt-uir-project"),
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: t0,
            commandId: CommandId.make("cmd-uir-project"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-uir-project"),
            metadata: {},
            payload: {
              projectId,
              title: "UIResponse Project",
              workspaceRoot: "/tmp/uiresponse",
              defaultModelSelection: null,
              scripts: [],
              createdAt: t0,
              updatedAt: t0,
            },
          });

          yield* appendAndProject({
            type: "thread.created",
            eventId: EventId.make("evt-uir-thread"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t0,
            commandId: CommandId.make("cmd-uir-thread"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-uir-thread"),
            metadata: {},
            payload: {
              threadId,
              projectId,
              title: "UIResponse Thread",
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5-codex",
              },
              runtimeMode: "full-access",
              branch: null,
              worktreePath: null,
              createdAt: t0,
              updatedAt: t0,
            },
          });

          // Request user input
          yield* appendAndProject({
            type: "thread.activity-appended",
            eventId: EventId.make("evt-uir-req"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t1,
            commandId: CommandId.make("cmd-uir-req"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-uir-req"),
            metadata: {},
            payload: {
              threadId,
              activity: {
                id: EventId.make("evt-uir-req"),
                tone: "info",
                kind: "user-input.requested",
                summary: "Input needed",
                payload: { requestId: reqId },
                turnId: null,
                createdAt: t1,
              },
            },
          });

          const afterReq = yield* readCounters;
          assert.equal(afterReq[0]?.pendingUserInputCount, 1);

          // Respond via thread.user-input-response-requested event (trigger path)
          yield* appendAndProject({
            type: "thread.user-input-response-requested",
            eventId: EventId.make("evt-uir-response"),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: t2,
            commandId: CommandId.make("cmd-uir-response"),
            causationEventId: null,
            correlationId: CorrelationId.make("cmd-uir-response"),
            metadata: {},
            payload: {
              threadId,
              requestId: reqId,
              answers: {},
              createdAt: t2,
            },
          });

          // thread.user-input-response-requested triggers refreshThreadShellSummary
          // but does NOT itself add a user-input.resolved activity — the provider
          // does that later. So pendingUserInputCount remains 1 until the activity arrives.
          const afterResponse = yield* readCounters;
          assert.equal(
            afterResponse[0]?.pendingUserInputCount,
            1,
            "pending user-input count stays 1 until user-input.resolved activity arrives",
          );
          assert.equal(afterResponse[0]?.pendingApprovalCount, 0);
        }),
    );
  },
);
