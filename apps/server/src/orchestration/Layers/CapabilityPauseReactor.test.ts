import {
  ProviderInstanceId,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { CapabilityPauseReactor } from "../Services/CapabilityPauseReactor.ts";
import {
  findExpiredCapabilityPauses,
  makeCapabilityPauseReactor,
} from "./CapabilityPauseReactor.ts";

const projectId = ProjectId.make("project-capability-reaper");
const taskId = TaskId.make("task-capability-reaper");
const stageThreadId = ThreadId.make("stage-capability-reaper");
const providerInstanceId = ProviderInstanceId.make("codex");
const expiresAt = "2026-07-22T10:30:00.000Z";
const unsupported = () => Effect.die(new Error("unsupported")) as never;

function pausedModel(input?: {
  readonly cancellation?: boolean;
  readonly expiresAt?: string | null;
}) {
  const cancellation = input?.cancellation
    ? {
        requestedAt: "2026-07-22T10:00:00.000Z",
        completedPhases: [],
        failurePhase: null,
        failureMessage: null,
        failedAt: null,
      }
    : null;
  return {
    snapshotSequence: 1,
    projects: [],
    threads: [],
    tasks: [
      {
        id: taskId,
        projectId,
        type: TaskTypeId.make("feature"),
        title: "Capability pause",
        status: "working" as const,
        branch: "ged/feature/capability-pause",
        worktreePath: "/tmp/capability-pause",
        prUrl: null,
        pmMessageId: null,
        stageThreadIds: [stageThreadId],
        currentStageThreadId: stageThreadId,
        changeReview: null,
        verification: null,
        noChangesNeeded: null,
        cancellation,
        landing: null,
        playbookVersion: "feature@v1",
        createdAt: "2026-07-22T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
      },
    ],
    helperRuns: [],
    projectContextRuns: [],
    pendingGates: [],
    quotaBlockedStages: [],
    stageHistory: {
      [stageThreadId]: {
        projectId,
        taskId,
        stageThreadId,
        role: "work" as const,
        capabilityTier: null,
        providerInstanceId,
        model: "gpt-5-codex",
        modelOptions: null,
        status: "paused" as const,
        ...(input?.expiresAt === null
          ? {}
          : { capabilityPauseExpiresAt: input?.expiresAt ?? expiresAt }),
        startedAt: "2026-07-22T10:00:00.000Z",
        endedAt: null,
      },
    },
    updatedAt: "2026-07-22T10:00:00.000Z",
  } satisfies OrchestrationReadModel;
}

describe("CapabilityPauseReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<CapabilityPauseReactor, never> | null = null;

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("selects only expired, non-cancelling paused stages after restart", () => {
    expect(findExpiredCapabilityPauses(pausedModel(), "2026-07-22T10:29:59.999Z")).toEqual([]);
    expect(findExpiredCapabilityPauses(pausedModel(), expiresAt)).toEqual([
      { taskId, stageThreadId, role: "work", expiresAt },
    ]);
    expect(
      findExpiredCapabilityPauses(pausedModel({ cancellation: true }), "2026-07-22T10:31:00.000Z"),
    ).toEqual([]);
    expect(
      findExpiredCapabilityPauses(pausedModel({ expiresAt: null }), "2026-07-22T10:31:00.000Z"),
    ).toEqual([]);
  });

  it("settles an overdue retained session once and does not re-settle it", async () => {
    let model: OrchestrationReadModel = pausedModel();
    const dispatched: OrchestrationCommand[] = [];
    const stopped: ThreadId[] = [];
    const engine = {
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
          dispatched.push(command);
          if (command.type === "task.stage.interrupt") {
            model = {
              ...model,
              tasks: model.tasks.map((task) =>
                task.id === taskId
                  ? { ...task, status: "blocked", currentStageThreadId: null }
                  : task,
              ),
              stageHistory: {
                ...model.stageHistory,
                [stageThreadId]: {
                  ...model.stageHistory[stageThreadId]!,
                  status: "interrupted",
                  capabilityPauseExpiresAt: null,
                  endedAt: command.createdAt,
                },
              },
            };
          }
          return { sequence: dispatched.length };
        }),
    } satisfies Pick<OrchestrationEngineShape, "dispatch">;
    runtime = ManagedRuntime.make(
      Layer.effect(
        CapabilityPauseReactor,
        makeCapabilityPauseReactor({ now: () => expiresAt }),
      ).pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, engine as unknown as OrchestrationEngineShape),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery, {
            getCommandReadModel: () => Effect.succeed(model),
            getSnapshot: () => Effect.succeed(model),
            getShellSnapshot: () => unsupported(),
            getArchivedShellSnapshot: () => unsupported(),
            getSnapshotSequence: () => unsupported(),
            getCounts: () => unsupported(),
            getActiveProjectByWorkspaceRoot: () => unsupported(),
            getProjectShellById: () => unsupported(),
            getFirstActiveThreadIdByProjectId: () => unsupported(),
            getThreadCheckpointContext: () => unsupported(),
            getFullThreadDiffContext: () => unsupported(),
            getThreadShellById: () => unsupported(),
            getThreadDetailById: () => unsupported(),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderService, {
            startSession: () => unsupported(),
            sendTurn: () => unsupported(),
            interruptTurn: () => unsupported(),
            respondToRequest: () => unsupported(),
            respondToUserInput: () => unsupported(),
            stopSession: ({ threadId }) => Effect.sync(() => void stopped.push(threadId)),
            listSessions: () => Effect.succeed([]),
            getCapabilities: () => unsupported(),
            getInstanceInfo: () => unsupported(),
            rollbackConversation: () => unsupported(),
            forkConversation: () => unsupported(),
            streamEvents: Stream.empty,
          } satisfies ProviderServiceShape),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(CapabilityPauseReactor));
    await expect(runtime.runPromise(reactor.reconcile())).resolves.toBe(1);
    await expect(runtime.runPromise(reactor.reconcile())).resolves.toBe(0);
    expect(dispatched).toMatchObject([
      {
        type: "task.stage.interrupt",
        taskId,
        stageThreadId,
        role: "work",
        reason: "capability-timeout",
      },
    ]);
    expect(stopped).toEqual([stageThreadId]);
  });
});
