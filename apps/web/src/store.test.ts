import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import {
  CheckpointRef,
  DEFAULT_MODEL,
  EnvironmentId,
  EventId,
  GateId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationStageHistoryEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  removeEnvironmentState,
  selectEnvironmentState,
  selectPendingGateById,
  selectPendingGatesForTaskRef,
  selectProjectPmQuotaBlockByRef,
  selectProjectsAcrossEnvironments,
  selectTaskByRef,
  selectTaskStageHistoryByRef,
  selectTasksForEnvironment,
  selectTasksForProjectRef,
  selectThreadByRef,
  selectThreadExistsByRef,
  setThreadBranch,
  selectThreadsAcrossEnvironments,
  syncOrchestratorProjectSnapshot,
  syncOrchestratorTaskSnapshot,
  type AppState,
  type EnvironmentState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

const localEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");

function withActiveEnvironmentState(
  environmentState: EnvironmentState,
  overrides: Partial<AppState & EnvironmentState> = {},
): AppState {
  const {
    activeEnvironmentId: overrideActiveEnvironmentId,
    environmentStateById: overrideEnvironmentStateById,
    ...environmentOverrides
  } = overrides;
  const activeEnvironmentId = overrideActiveEnvironmentId ?? localEnvironmentId;
  const mergedEnvironmentState = {
    ...environmentState,
    ...environmentOverrides,
  };
  const environmentStateById =
    overrideEnvironmentStateById ??
    (activeEnvironmentId
      ? {
          [activeEnvironmentId]: mergedEnvironmentState,
        }
      : {});

  return {
    activeEnvironmentId,
    environmentStateById,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    codexThreadId: null,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  const projectId = ProjectId.make("project-1");
  const project = {
    id: projectId,
    environmentId: thread.environmentId,
    name: "Project",
    cwd: "/tmp/project",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    scripts: [],
  };
  const threadIdsByProjectId: EnvironmentState["threadIdsByProjectId"] = {
    [thread.projectId]: [thread.id],
  };
  const environmentState = {
    projectIds: [projectId],
    projectById: {
      [projectId]: project,
    },
    taskIds: [],
    taskIdsByProjectId: {},
    taskById: {},
    pendingGateIdsByTaskId: {},
    pendingGateById: {},
    quotaBlockedStageByTaskId: {},
    stageHistoryByTaskId: {},
    pmQuotaBlockByProjectId: {},
    threadIds: [thread.id],
    threadIdsByProjectId,
    threadShellById: {
      [thread.id]: {
        id: thread.id,
        environmentId: thread.environmentId,
        codexThreadId: thread.codexThreadId,
        projectId: thread.projectId,
        title: thread.title,
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        error: thread.error,
        createdAt: thread.createdAt,
        archivedAt: thread.archivedAt,
        updatedAt: thread.updatedAt,
        ...(thread.lastClearedSequence !== undefined
          ? { lastClearedSequence: thread.lastClearedSequence }
          : {}),
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      },
    },
    threadSessionById: {
      [thread.id]: thread.session,
    },
    threadTurnStateById: {
      [thread.id]: {
        latestTurn: thread.latestTurn,
        ...(thread.pendingSourceProposedPlan
          ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
          : {}),
      },
    },
    messageIdsByThreadId: {
      [thread.id]: thread.messages.map((message) => message.id),
    },
    messageByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.messages.map((message) => [message.id, message] as const),
      ) as EnvironmentState["messageByThreadId"][ThreadId],
    },
    activityIdsByThreadId: {
      [thread.id]: thread.activities.map((activity) => activity.id),
    },
    activityByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.activities.map((activity) => [activity.id, activity] as const),
      ) as EnvironmentState["activityByThreadId"][ThreadId],
    },
    proposedPlanIdsByThreadId: {
      [thread.id]: thread.proposedPlans.map((plan) => plan.id),
    },
    proposedPlanByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.proposedPlans.map((plan) => [plan.id, plan] as const),
      ) as EnvironmentState["proposedPlanByThreadId"][ThreadId],
    },
    turnDiffIdsByThreadId: {
      [thread.id]: thread.turnDiffSummaries.map((summary) => summary.turnId),
    },
    turnDiffSummaryByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
      ) as EnvironmentState["turnDiffSummaryByThreadId"][ThreadId],
    },
    sidebarThreadSummaryById: {},
    bootstrapComplete: true,
  };
  return withActiveEnvironmentState(environmentState, {
    activeEnvironmentId: thread.environmentId,
  });
}

function makeEmptyState(overrides: Partial<AppState & EnvironmentState> = {}): AppState {
  const environmentState: EnvironmentState = {
    projectIds: [],
    projectById: {},
    taskIds: [],
    taskIdsByProjectId: {},
    taskById: {},
    pendingGateIdsByTaskId: {},
    pendingGateById: {},
    quotaBlockedStageByTaskId: {},
    stageHistoryByTaskId: {},
    pmQuotaBlockByProjectId: {},
    threadIds: [],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    sidebarThreadSummaryById: {},
    bootstrapComplete: true,
  };
  return withActiveEnvironmentState(environmentState, overrides);
}

function localEnvironmentStateOf(state: AppState): EnvironmentState {
  return selectEnvironmentState(state, localEnvironmentId);
}

function environmentStateOf(state: AppState, environmentId: EnvironmentId): EnvironmentState {
  return selectEnvironmentState(state, environmentId);
}

function projectsOf(state: AppState) {
  return selectProjectsAcrossEnvironments(state);
}

function threadsOf(state: AppState) {
  return selectThreadsAcrossEnvironments(state);
}

function tasksOf(state: AppState) {
  return selectTasksForEnvironment(state, localEnvironmentId);
}

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {},
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1;
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId:
      "threadId" in payload
        ? payload.threadId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.make("project-1"),
    occurredAt: "2026-02-27T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>;
}

describe("environment state removal", () => {
  it("drops local state for removed environments", () => {
    const removedThread = makeThread({
      environmentId: remoteEnvironmentId,
      id: ThreadId.make("thread-removed"),
    });
    const keptThread = makeThread({ id: ThreadId.make("thread-kept") });
    const removedState = makeState(removedThread).environmentStateById[remoteEnvironmentId]!;
    const keptState = makeState(keptThread).environmentStateById[localEnvironmentId]!;
    const state: AppState = {
      activeEnvironmentId: remoteEnvironmentId,
      environmentStateById: {
        [remoteEnvironmentId]: removedState,
        [localEnvironmentId]: keptState,
      },
    };

    const next = removeEnvironmentState(state, remoteEnvironmentId);

    expect(next.activeEnvironmentId).toBeNull();
    expect(next.environmentStateById[remoteEnvironmentId]).toBeUndefined();
    expect(next.environmentStateById[localEnvironmentId]).toBe(keptState);
  });

  it("preserves active environment when removing a different environment", () => {
    const state = makeState(makeThread());

    const next = removeEnvironmentState(state, remoteEnvironmentId);

    expect(next).toBe(state);
  });
});

describe("thread selection memoization", () => {
  it("returns stable thread references for repeated reads of the same state", () => {
    const thread = makeThread({
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "user",
          text: "hello",
          createdAt: "2026-02-13T00:01:00.000Z",
          streaming: false,
        },
      ],
      activities: [
        {
          id: EventId.make("activity-1"),
          tone: "info",
          kind: "step",
          summary: "working",
          payload: {},
          turnId: TurnId.make("turn-1"),
          createdAt: "2026-02-13T00:01:30.000Z",
        },
      ],
      proposedPlans: [
        {
          id: "plan-1",
          turnId: null,
          planMarkdown: "plan",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-13T00:02:00.000Z",
          updatedAt: "2026-02-13T00:02:00.000Z",
        },
      ],
      turnDiffSummaries: [
        {
          turnId: TurnId.make("turn-1"),
          completedAt: "2026-02-13T00:03:00.000Z",
          files: [],
        },
      ],
    });
    const state = makeState(thread);
    const ref = scopeThreadRef(thread.environmentId, thread.id);

    const first = selectThreadByRef(state, ref);
    const second = selectThreadByRef(state, ref);

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(second?.messages).toBe(first?.messages);
    expect(second?.activities).toBe(first?.activities);
    expect(second?.proposedPlans).toBe(first?.proposedPlans);
    expect(second?.turnDiffSummaries).toBe(first?.turnDiffSummaries);
  });

  it("reuses the derived thread when the app state wrapper changes but thread data does not", () => {
    const thread = makeThread({
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "done",
          createdAt: "2026-02-13T00:01:00.000Z",
          streaming: false,
        },
      ],
    });
    const state = makeState(thread);
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const wrappedState: AppState = {
      ...state,
      environmentStateById: { ...state.environmentStateById },
    };

    const first = selectThreadByRef(state, ref);
    const second = selectThreadByRef(wrappedState, ref);

    expect(second).toBe(first);
  });

  it("updates the derived thread when the underlying thread data changes", () => {
    const thread = makeThread();
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const firstState = makeState(thread);
    const secondState = makeState({
      ...thread,
      messages: [
        {
          id: MessageId.make("message-2"),
          role: "user",
          text: "new",
          createdAt: "2026-02-13T00:04:00.000Z",
          streaming: false,
        },
      ],
    });

    const first = selectThreadByRef(firstState, ref);
    const second = selectThreadByRef(secondState, ref);

    expect(second).not.toBe(first);
    expect(second?.messages).toHaveLength(1);
    expect(second?.messages[0]?.text).toBe("new");
  });

  it("checks thread existence without materializing the full thread", () => {
    const thread = makeThread();
    const state = makeState(thread);
    const ref = scopeThreadRef(thread.environmentId, thread.id);

    expect(selectThreadExistsByRef(state, ref)).toBe(true);
    expect(
      selectThreadExistsByRef(
        state,
        scopeThreadRef(thread.environmentId, ThreadId.make("missing")),
      ),
    ).toBe(false);
    expect(selectThreadExistsByRef(state, null)).toBe(false);
  });
});

describe("setThreadBranch", () => {
  it("updates only the scoped thread environment", () => {
    const sharedThreadId = ThreadId.make("thread-shared");
    const localThread = makeThread({
      id: sharedThreadId,
      environmentId: localEnvironmentId,
      branch: "local-branch",
    });
    const remoteThread = makeThread({
      id: sharedThreadId,
      environmentId: remoteEnvironmentId,
      branch: "remote-branch",
    });
    const state: AppState = {
      activeEnvironmentId: localEnvironmentId,
      environmentStateById: {
        [localEnvironmentId]: environmentStateOf(makeState(localThread), localEnvironmentId),
        [remoteEnvironmentId]: environmentStateOf(makeState(remoteThread), remoteEnvironmentId),
      },
    };

    const next = setThreadBranch(
      state,
      scopeThreadRef(remoteEnvironmentId, sharedThreadId),
      "remote-next",
      "/tmp/remote-worktree",
    );

    expect(
      environmentStateOf(next, localEnvironmentId).threadShellById[sharedThreadId]?.branch,
    ).toBe("local-branch");
    expect(
      environmentStateOf(next, remoteEnvironmentId).threadShellById[sharedThreadId]?.branch,
    ).toBe("remote-next");
    expect(
      environmentStateOf(next, remoteEnvironmentId).threadShellById[sharedThreadId]?.worktreePath,
    ).toBe("/tmp/remote-worktree");
  });
});

describe("incremental orchestration updates", () => {
  it("does not mark bootstrap complete for incremental events", () => {
    const state = withActiveEnvironmentState(localEnvironmentStateOf(makeState(makeThread())), {
      bootstrapComplete: false,
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.meta-updated", {
        threadId: ThreadId.make("thread-1"),
        title: "Updated title",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(localEnvironmentStateOf(next).bootstrapComplete).toBe(false);
  });

  it("preserves state identity for no-op project and thread deletes", () => {
    const thread = makeThread();
    const state = makeState(thread);

    const nextAfterProjectDelete = applyOrchestrationEvent(
      state,
      makeEvent("project.deleted", {
        projectId: ProjectId.make("project-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );
    const nextAfterThreadDelete = applyOrchestrationEvent(
      state,
      makeEvent("thread.deleted", {
        threadId: ThreadId.make("thread-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(nextAfterProjectDelete).toBe(state);
    expect(nextAfterThreadDelete).toBe(state);
  });

  it("clears visible thread messages and indexes for thread.cleared", () => {
    const threadId = ThreadId.make("pm:project-1");
    const messageId = MessageId.make("pm-message-before-clear");
    const thread = makeThread({
      id: threadId,
      session: {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        status: "running",
        activeTurnId: TurnId.make("turn-before-clear"),
        createdAt: "2026-02-27T00:00:10.000Z",
        updatedAt: "2026-02-27T00:00:30.000Z",
        lastError: "stale error",
        orchestrationStatus: "running",
      },
      latestTurn: {
        turnId: TurnId.make("turn-before-clear"),
        state: "running",
        requestedAt: "2026-02-27T00:00:10.000Z",
        startedAt: "2026-02-27T00:00:20.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      messages: [
        {
          id: messageId,
          role: "user",
          text: "before clear",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: "2026-02-27T00:00:00.000Z",
        },
      ],
      activities: [
        {
          id: EventId.make("activity-before-clear"),
          tone: "info",
          kind: "turn.started",
          summary: "stale activity",
          payload: {},
          turnId: TurnId.make("turn-before-clear"),
          createdAt: "2026-02-27T00:00:20.000Z",
        },
      ],
      turnDiffSummaries: [
        {
          turnId: TurnId.make("turn-before-clear"),
          completedAt: "2026-02-27T00:00:40.000Z",
          files: [],
        },
      ],
    });
    const state = makeState(thread);

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.cleared", {
        threadId,
        clearedAt: "2026-02-27T00:01:00.000Z",
      }),
      localEnvironmentId,
    );

    const nextEnvironment = localEnvironmentStateOf(next);
    expect(nextEnvironment.messageIdsByThreadId[threadId]).toEqual([]);
    expect(nextEnvironment.messageByThreadId[threadId]).toEqual({});
    expect(nextEnvironment.activityIdsByThreadId[threadId]).toEqual([]);
    expect(nextEnvironment.turnDiffIdsByThreadId[threadId]).toEqual([]);

    const clearedThread = selectThreadByRef(next, scopeThreadRef(localEnvironmentId, threadId));
    expect(clearedThread?.session).toBeNull();
    expect(clearedThread?.latestTurn).toBeNull();
    expect(clearedThread?.lastClearedSequence).toBe(1);
  });

  it("reuses an existing project row when project.created arrives with a new id for the same cwd", () => {
    const originalProjectId = ProjectId.make("project-1");
    const recreatedProjectId = ProjectId.make("project-2");
    const state: AppState = makeEmptyState({
      projectIds: [originalProjectId],
      projectById: {
        [originalProjectId]: {
          id: originalProjectId,
          environmentId: localEnvironmentId,
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          scripts: [],
        },
      },
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("project.created", {
        projectId: recreatedProjectId,
        title: "Project Recreated",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        scripts: [],
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(projectsOf(next)).toHaveLength(1);
    expect(projectsOf(next)[0]?.id).toBe(recreatedProjectId);
    expect(projectsOf(next)[0]?.cwd).toBe("/tmp/project");
    expect(projectsOf(next)[0]?.name).toBe("Project Recreated");
    expect(localEnvironmentStateOf(next).projectIds).toEqual([recreatedProjectId]);
    expect(localEnvironmentStateOf(next).projectById[originalProjectId]).toBeUndefined();
    expect(localEnvironmentStateOf(next).projectById[recreatedProjectId]?.id).toBe(
      recreatedProjectId,
    );
  });

  it("removes stale project index entries when thread.created recreates a thread under a new project", () => {
    const originalProjectId = ProjectId.make("project-1");
    const recreatedProjectId = ProjectId.make("project-2");
    const threadId = ThreadId.make("thread-1");
    const thread = makeThread({
      id: threadId,
      projectId: originalProjectId,
    });
    const state = withActiveEnvironmentState(localEnvironmentStateOf(makeState(thread)), {
      projectIds: [originalProjectId, recreatedProjectId],
      projectById: {
        [originalProjectId]: {
          id: originalProjectId,
          environmentId: localEnvironmentId,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          scripts: [],
        },
        [recreatedProjectId]: {
          id: recreatedProjectId,
          environmentId: localEnvironmentId,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          scripts: [],
        },
      },
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.created", {
        threadId,
        projectId: recreatedProjectId,
        title: "Recovered thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(threadsOf(next)).toHaveLength(1);
    expect(threadsOf(next)[0]?.projectId).toBe(recreatedProjectId);
    expect(localEnvironmentStateOf(next).threadIdsByProjectId[originalProjectId]).toBeUndefined();
    expect(localEnvironmentStateOf(next).threadIdsByProjectId[recreatedProjectId]).toEqual([
      threadId,
    ]);
  });

  it("reduces task events into project task and pending-gate selectors", () => {
    const projectId = ProjectId.make("project-1");
    const taskId = TaskId.make("task-1");
    const gateId = GateId.make("gate-plan");
    const stageThreadId = ThreadId.make("thread-plan");
    const state = makeEmptyState({
      projectIds: [projectId],
      projectById: {
        [projectId]: {
          id: projectId,
          environmentId: localEnvironmentId,
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          scripts: [],
        },
      },
    });

    const next = applyOrchestrationEvents(
      state,
      [
        makeEvent(
          "task.created",
          {
            taskId,
            projectId,
            taskType: TaskTypeId.make("feature"),
            title: "Implement orchestrator route",
            branch: "orchestrator/task-1",
            worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
            pmMessageId: MessageId.make("pm-message-1"),
            playbookVersion: "feature@v1",
            createdAt: "2026-02-27T00:00:01.000Z",
            updatedAt: "2026-02-27T00:00:01.000Z",
          },
          { sequence: 2, aggregateKind: "task", aggregateId: taskId },
        ),
        makeEvent(
          "task.stage-started",
          {
            taskId,
            role: "plan",
            stageThreadId,
            awaitedTurnId: TurnId.make("turn-plan"),
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
          { sequence: 3, aggregateKind: "task", aggregateId: taskId },
        ),
        makeEvent(
          "task.gate-requested",
          {
            taskId,
            gateId,
            gate: "plan",
            contentHash: "sha256:plan",
            stageThreadId,
            updatedAt: "2026-02-27T00:00:03.000Z",
          },
          { sequence: 4, aggregateKind: "task", aggregateId: taskId },
        ),
        makeEvent(
          "task.gate-resolved",
          {
            taskId,
            gateId,
            gate: "plan",
            approvedHash: "sha256:plan",
            decision: "approved",
            origin: "human",
            updatedAt: "2026-02-27T00:00:04.000Z",
          },
          { sequence: 5, aggregateKind: "task", aggregateId: taskId },
        ),
        makeEvent(
          "task.gate-requested",
          {
            taskId,
            gateId,
            gate: "plan",
            contentHash: "sha256:plan",
            stageThreadId,
            updatedAt: "2026-02-27T00:00:05.000Z",
          },
          { sequence: 6, aggregateKind: "task", aggregateId: taskId },
        ),
      ],
      localEnvironmentId,
    );

    const taskRef = { environmentId: localEnvironmentId, taskId };
    const projectTasks = selectTasksForProjectRef(
      next,
      scopeProjectRef(localEnvironmentId, projectId),
    );
    const task = selectTaskByRef(next, taskRef);
    const gates = selectPendingGatesForTaskRef(next, taskRef);

    expect(projectTasks.map((entry) => entry.id)).toEqual([taskId]);
    expect(task?.status).toBe("planning");
    expect(task?.stageThreadIds).toEqual([stageThreadId]);
    expect(task?.currentStageThreadId).toBe(stageThreadId);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.status).toBe("resolved");
    expect(gates[0]?.decision).toBe("approved");
    expect(gates[0]?.origin).toBe("human");
    expect(gates[0]?.resolvedAt).toBe("2026-02-27T00:00:04.000Z");
  });

  it("removes archived and deleted tasks from active client state", () => {
    const projectId = ProjectId.make("project-retention-store");
    const taskId = TaskId.make("task-retention-store");
    const createdAt = "2026-07-12T09:00:00.000Z";
    const created = makeEvent(
      "task.created",
      {
        taskId,
        projectId,
        taskType: TaskTypeId.make("feature"),
        title: "Retention store",
        branch: null,
        worktreePath: null,
        pmMessageId: null,
        playbookVersion: null,
        createdAt,
        updatedAt: createdAt,
      },
      { sequence: 1, aggregateKind: "task", aggregateId: taskId },
    );
    const withTask = applyOrchestrationEvents(makeEmptyState(), [created], localEnvironmentId);
    expect(tasksOf(withTask)).toHaveLength(1);
    expect(tasksOf(withTask)[0]).toMatchObject({ archivedAt: null, deletedAt: null });

    const archived = applyOrchestrationEvents(
      withTask,
      [
        makeEvent(
          "task.archived",
          { taskId, archivedAt: createdAt, updatedAt: createdAt },
          { sequence: 2, aggregateKind: "task", aggregateId: taskId },
        ),
      ],
      localEnvironmentId,
    );
    expect(tasksOf(archived)).toHaveLength(0);

    const restored = applyOrchestrationEvents(
      archived,
      [
        makeEvent(
          "task.restored",
          {
            taskId,
            task: { ...tasksOf(withTask)[0]!, archivedAt: null, updatedAt: createdAt },
            updatedAt: createdAt,
          },
          { sequence: 3, aggregateKind: "task", aggregateId: taskId },
        ),
      ],
      localEnvironmentId,
    );
    expect(tasksOf(restored)).toHaveLength(1);
    expect(tasksOf(restored)[0]?.archivedAt).toBeNull();

    const deleted = applyOrchestrationEvents(
      withTask,
      [
        makeEvent(
          "task.deleted",
          { taskId, deletedAt: createdAt, updatedAt: createdAt },
          { sequence: 2, aggregateKind: "task", aggregateId: taskId },
        ),
      ],
      localEnvironmentId,
    );
    expect(tasksOf(deleted)).toHaveLength(0);
  });

  it("reduces cancellation progress and ignores failures without a reservation", () => {
    const projectId = ProjectId.make("project-cancellation-store");
    const taskId = TaskId.make("task-cancellation-store");
    const outOfOrderTaskId = TaskId.make("task-cancellation-store-out-of-order");
    const createdAt = "2026-07-11T00:00:00.000Z";
    const requestedAt = "2026-07-11T00:01:00.000Z";
    const interruptedAt = "2026-07-11T00:02:00.000Z";
    const failedAt = "2026-07-11T00:03:00.000Z";
    const taskCreatedPayload = (createdTaskId: TaskId, title: string) => ({
      taskId: createdTaskId,
      projectId,
      taskType: TaskTypeId.make("feature"),
      title,
      branch: null,
      worktreePath: null,
      pmMessageId: null,
      playbookVersion: null,
      createdAt,
      updatedAt: createdAt,
    });

    const next = applyOrchestrationEvents(
      makeEmptyState(),
      [
        makeEvent("task.created", taskCreatedPayload(taskId, "Cancellation store"), {
          sequence: 1,
          aggregateKind: "task",
          aggregateId: taskId,
        }),
        makeEvent(
          "task.created",
          taskCreatedPayload(outOfOrderTaskId, "Out-of-order cancellation store"),
          {
            sequence: 2,
            aggregateKind: "task",
            aggregateId: outOfOrderTaskId,
          },
        ),
        makeEvent(
          "task.cancellation-requested",
          { taskId, requestedAt, updatedAt: requestedAt },
          { sequence: 3, aggregateKind: "task", aggregateId: taskId },
        ),
        makeEvent(
          "task.cancellation-phase-completed",
          { taskId, phase: "interrupt-turn", updatedAt: interruptedAt },
          { sequence: 4, aggregateKind: "task", aggregateId: taskId },
        ),
        makeEvent(
          "task.cancellation-failed",
          {
            taskId,
            phase: "stop-session",
            message: "provider session did not stop",
            failedAt,
            updatedAt: failedAt,
          },
          { sequence: 5, aggregateKind: "task", aggregateId: taskId },
        ),
        makeEvent(
          "task.cancellation-failed",
          {
            taskId: outOfOrderTaskId,
            phase: "interrupt-turn",
            message: "no cancellation reservation",
            failedAt,
            updatedAt: failedAt,
          },
          { sequence: 6, aggregateKind: "task", aggregateId: outOfOrderTaskId },
        ),
      ],
      localEnvironmentId,
    );

    expect(
      selectTaskByRef(next, { environmentId: localEnvironmentId, taskId })?.cancellation,
    ).toEqual({
      requestedAt,
      completedPhases: ["interrupt-turn"],
      failurePhase: "stop-session",
      failureMessage: "provider session did not stop",
      failedAt,
    });
    expect(selectTaskByRef(next, { environmentId: localEnvironmentId, taskId })?.updatedAt).toBe(
      failedAt,
    );
    expect(
      selectTaskByRef(next, {
        environmentId: localEnvironmentId,
        taskId: outOfOrderTaskId,
      })?.cancellation,
    ).toBeNull();
    expect(
      selectTaskByRef(next, {
        environmentId: localEnvironmentId,
        taskId: outOfOrderTaskId,
      })?.updatedAt,
    ).toBe(createdAt);
  });

  it("prunes stale orchestrator task and gate state from snapshots", () => {
    const projectId = ProjectId.make("project-1");
    const retainedTaskId = TaskId.make("task-retained");
    const removedTaskId = TaskId.make("task-removed");
    const retainedGateId = GateId.make("gate-retained");
    const removedGateId = GateId.make("gate-removed");
    const state = makeEmptyState();
    const seeded = applyOrchestrationEvents(
      state,
      [
        makeEvent(
          "task.created",
          {
            taskId: retainedTaskId,
            projectId,
            taskType: TaskTypeId.make("feature"),
            title: "Retained task",
            branch: null,
            worktreePath: null,
            pmMessageId: null,
            playbookVersion: null,
            createdAt: "2026-02-27T00:00:01.000Z",
            updatedAt: "2026-02-27T00:00:01.000Z",
          },
          { sequence: 1, aggregateKind: "task", aggregateId: retainedTaskId },
        ),
        makeEvent(
          "task.gate-requested",
          {
            taskId: retainedTaskId,
            gateId: retainedGateId,
            gate: "plan",
            contentHash: "sha256:retained",
            stageThreadId: null,
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
          { sequence: 2, aggregateKind: "task", aggregateId: retainedTaskId },
        ),
        makeEvent(
          "task.gate-requested",
          {
            taskId: retainedTaskId,
            gateId: removedGateId,
            gate: "land",
            contentHash: "sha256:removed-gate",
            stageThreadId: null,
            updatedAt: "2026-02-27T00:00:03.000Z",
          },
          { sequence: 3, aggregateKind: "task", aggregateId: retainedTaskId },
        ),
        makeEvent(
          "task.created",
          {
            taskId: removedTaskId,
            projectId,
            taskType: TaskTypeId.make("feature"),
            title: "Removed task",
            branch: null,
            worktreePath: null,
            pmMessageId: null,
            playbookVersion: null,
            createdAt: "2026-02-27T00:00:04.000Z",
            updatedAt: "2026-02-27T00:00:04.000Z",
          },
          { sequence: 4, aggregateKind: "task", aggregateId: removedTaskId },
        ),
      ],
      localEnvironmentId,
    );
    const retainedTask = selectTaskByRef(seeded, {
      environmentId: localEnvironmentId,
      taskId: retainedTaskId,
    });
    const retainedGate = selectPendingGateById(seeded, localEnvironmentId, retainedGateId);
    if (!retainedTask || !retainedGate) {
      throw new Error("Expected seeded task and gate to exist.");
    }

    const taskSnapshotState = syncOrchestratorTaskSnapshot(
      seeded,
      {
        snapshotSequence: 10,
        task: retainedTask,
        pendingGates: [retainedGate],
        stageHistory: {},
      },
      localEnvironmentId,
    );

    expect(
      selectPendingGateById(taskSnapshotState, localEnvironmentId, removedGateId),
    ).toBeUndefined();

    const projectSnapshotState = syncOrchestratorProjectSnapshot(
      taskSnapshotState,
      {
        snapshotSequence: 11,
        project: {
          id: projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          scripts: [],
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          deletedAt: null,
        },
        pmThreadId: ThreadId.make("pm-project-1"),
        pmThread: null,
        pmQuotaBlock: null,
        tasks: [retainedTask],
        pendingGates: [retainedGate],
        quotaBlockedStages: [],
        stageHistory: {},
      },
      localEnvironmentId,
    );

    expect(
      selectTasksForProjectRef(
        projectSnapshotState,
        scopeProjectRef(localEnvironmentId, projectId),
      ).map((task) => task.id),
    ).toEqual([retainedTaskId]);
    expect(
      selectTaskByRef(projectSnapshotState, {
        environmentId: localEnvironmentId,
        taskId: removedTaskId,
      }),
    ).toBeUndefined();
    expect(
      selectPendingGatesForTaskRef(projectSnapshotState, {
        environmentId: localEnvironmentId,
        taskId: retainedTaskId,
      }).map((gate) => gate.gateId),
    ).toEqual([retainedGateId]);
  });

  it("syncs PM quota block state from project snapshots", () => {
    const projectId = ProjectId.make("project-1");
    const projectRef = scopeProjectRef(localEnvironmentId, projectId);
    const quotaBlock = {
      providerInstanceId: ProviderInstanceId.make("codex"),
      status: "blocked-until",
      resetAt: "2026-02-27T01:00:00.000Z",
    } as const;
    const baseState = makeEmptyState({ activeEnvironmentId: localEnvironmentId });
    const blockedState = syncOrchestratorProjectSnapshot(
      baseState,
      {
        snapshotSequence: 1,
        project: {
          id: projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          scripts: [],
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          deletedAt: null,
        },
        pmThreadId: ThreadId.make("pm:project-1"),
        pmThread: null,
        pmQuotaBlock: quotaBlock,
        tasks: [],
        pendingGates: [],
        quotaBlockedStages: [],
        stageHistory: {},
      },
      localEnvironmentId,
    );

    expect(selectProjectPmQuotaBlockByRef(blockedState, projectRef)).toEqual({
      providerInstanceId: ProviderInstanceId.make("codex"),
      status: "blocked-until",
      resetAt: "2026-02-27T01:00:00.000Z",
    });

    const clearedState = syncOrchestratorProjectSnapshot(
      blockedState,
      {
        snapshotSequence: 2,
        project: {
          id: projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          scripts: [],
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          deletedAt: null,
        },
        pmThreadId: ThreadId.make("pm:project-1"),
        pmThread: null,
        pmQuotaBlock: null,
        tasks: [],
        pendingGates: [],
        quotaBlockedStages: [],
        stageHistory: {},
      },
      localEnvironmentId,
    );

    expect(selectProjectPmQuotaBlockByRef(clearedState, projectRef)).toBeUndefined();

    const skippedState = syncOrchestratorProjectSnapshot(
      clearedState,
      {
        snapshotSequence: 3,
        project: {
          id: projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          scripts: [],
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          deletedAt: null,
        },
        pmThreadId: ThreadId.make("pm:project-1"),
        pmThread: null,
        pmQuotaBlock: quotaBlock,
        tasks: [],
        pendingGates: [],
        quotaBlockedStages: [],
        stageHistory: {},
      },
      localEnvironmentId,
      { skipPmThread: true },
    );

    expect(selectProjectPmQuotaBlockByRef(skippedState, projectRef)).toBeUndefined();

    const appliedState = syncOrchestratorProjectSnapshot(
      clearedState,
      {
        snapshotSequence: 4,
        project: {
          id: projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          scripts: [],
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
          deletedAt: null,
        },
        pmThreadId: ThreadId.make("pm:project-1"),
        pmThread: null,
        pmQuotaBlock: quotaBlock,
        tasks: [],
        pendingGates: [],
        quotaBlockedStages: [],
        stageHistory: {},
      },
      localEnvironmentId,
      { skipPmThread: false },
    );

    expect(selectProjectPmQuotaBlockByRef(appliedState, projectRef)).toEqual(quotaBlock);
  });

  it("updates PM quota block state from PM thread activity and clears it on PM messages", () => {
    const projectId = ProjectId.make("project-1");
    const pmThreadId = ThreadId.make("pm:project-1");
    const projectRef = scopeProjectRef(localEnvironmentId, projectId);
    const state = makeState(makeThread({ id: pmThreadId, projectId }));

    const blocked = applyOrchestrationEvent(
      state,
      makeEvent(
        "thread.activity-appended",
        {
          threadId: pmThreadId,
          activity: {
            id: EventId.make("activity-pm-quota"),
            tone: "info",
            kind: "quota.paused",
            summary: "Paused - codex usage limit reached",
            payload: {
              providerInstanceId: ProviderInstanceId.make("codex"),
              resetAt: null,
            },
            turnId: null,
            createdAt: "2026-02-27T00:00:00.000Z",
          },
        },
        { aggregateKind: "thread", aggregateId: pmThreadId },
      ),
      localEnvironmentId,
    );

    expect(selectProjectPmQuotaBlockByRef(blocked, projectRef)).toEqual({
      providerInstanceId: ProviderInstanceId.make("codex"),
      status: "blocked-unknown",
      resetAt: null,
    });

    const cleared = applyOrchestrationEvent(
      blocked,
      makeEvent(
        "thread.message-sent",
        {
          threadId: pmThreadId,
          messageId: MessageId.make("pm-message-recovered"),
          role: "assistant",
          text: "Recovered.",
          turnId: null,
          streaming: false,
          createdAt: "2026-02-27T00:01:00.000Z",
          updatedAt: "2026-02-27T00:01:00.000Z",
        },
        { sequence: 2, aggregateKind: "thread", aggregateId: pmThreadId },
      ),
      localEnvironmentId,
    );

    expect(selectProjectPmQuotaBlockByRef(cleared, projectRef)).toBeUndefined();
  });

  it("updates only the affected thread for message events", () => {
    const thread1 = makeThread({
      id: ThreadId.make("thread-1"),
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "hello",
          turnId: TurnId.make("turn-1"),
          createdAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:00.000Z",
          streaming: false,
        },
      ],
    });
    const thread2 = makeThread({ id: ThreadId.make("thread-2") });
    const baseState = makeState(thread1);
    const baseEnvironmentState = localEnvironmentStateOf(baseState);
    const state = withActiveEnvironmentState(baseEnvironmentState, {
      threadIds: [thread1.id, thread2.id],
      threadShellById: {
        ...baseEnvironmentState.threadShellById,
        [thread2.id]: {
          id: thread2.id,
          environmentId: thread2.environmentId,
          codexThreadId: thread2.codexThreadId,
          projectId: thread2.projectId,
          title: thread2.title,
          modelSelection: thread2.modelSelection,
          runtimeMode: thread2.runtimeMode,
          interactionMode: thread2.interactionMode,
          error: thread2.error,
          createdAt: thread2.createdAt,
          archivedAt: thread2.archivedAt,
          updatedAt: thread2.updatedAt,
          branch: thread2.branch,
          worktreePath: thread2.worktreePath,
        },
      },
      threadSessionById: {
        ...baseEnvironmentState.threadSessionById,
        [thread2.id]: thread2.session,
      },
      threadTurnStateById: {
        ...baseEnvironmentState.threadTurnStateById,
        [thread2.id]: {
          latestTurn: thread2.latestTurn,
        },
      },
      messageIdsByThreadId: {
        ...baseEnvironmentState.messageIdsByThreadId,
        [thread2.id]: [],
      },
      messageByThreadId: {
        ...baseEnvironmentState.messageByThreadId,
        [thread2.id]: {},
      },
      activityIdsByThreadId: {
        ...baseEnvironmentState.activityIdsByThreadId,
        [thread2.id]: [],
      },
      activityByThreadId: {
        ...baseEnvironmentState.activityByThreadId,
        [thread2.id]: {},
      },
      proposedPlanIdsByThreadId: {
        ...baseEnvironmentState.proposedPlanIdsByThreadId,
        [thread2.id]: [],
      },
      proposedPlanByThreadId: {
        ...baseEnvironmentState.proposedPlanByThreadId,
        [thread2.id]: {},
      },
      turnDiffIdsByThreadId: {
        ...baseEnvironmentState.turnDiffIdsByThreadId,
        [thread2.id]: [],
      },
      turnDiffSummaryByThreadId: {
        ...baseEnvironmentState.turnDiffSummaryByThreadId,
        [thread2.id]: {},
      },
      sidebarThreadSummaryById: {
        ...baseEnvironmentState.sidebarThreadSummaryById,
      },
      threadIdsByProjectId: {
        [thread1.projectId]: [thread1.id, thread2.id],
      },
    });

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.message-sent", {
        threadId: thread1.id,
        messageId: MessageId.make("message-1"),
        role: "assistant",
        text: " world",
        turnId: TurnId.make("turn-1"),
        streaming: true,
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(threadsOf(next)[0]?.messages[0]?.text).toBe("hello world");
    expect(threadsOf(next)[0]?.latestTurn?.state).toBe("running");
    const nextEnvironmentState = next.environmentStateById[localEnvironmentId];
    const previousEnvironmentState = state.environmentStateById[localEnvironmentId];
    expect(nextEnvironmentState?.threadShellById[thread2.id]).toBe(
      previousEnvironmentState?.threadShellById[thread2.id],
    );
    expect(nextEnvironmentState?.threadSessionById[thread2.id]).toBe(
      previousEnvironmentState?.threadSessionById[thread2.id],
    );
    expect(nextEnvironmentState?.messageIdsByThreadId[thread2.id]).toBe(
      previousEnvironmentState?.messageIdsByThreadId[thread2.id],
    );
    expect(nextEnvironmentState?.messageByThreadId[thread2.id]).toBe(
      previousEnvironmentState?.messageByThreadId[thread2.id],
    );
  });

  it("applies replay batches in sequence and updates session state", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "running",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const state = makeState(thread);

    const next = applyOrchestrationEvents(
      state,
      [
        makeEvent(
          "thread.session-set",
          {
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "running",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn-1"),
              lastError: null,
              updatedAt: "2026-02-27T00:00:02.000Z",
            },
          },
          { sequence: 2 },
        ),
        makeEvent(
          "thread.message-sent",
          {
            threadId: thread.id,
            messageId: MessageId.make("assistant-1"),
            role: "assistant",
            text: "done",
            turnId: TurnId.make("turn-1"),
            streaming: false,
            createdAt: "2026-02-27T00:00:03.000Z",
            updatedAt: "2026-02-27T00:00:03.000Z",
          },
          { sequence: 3 },
        ),
      ],
      localEnvironmentId,
    );

    expect(threadsOf(next)[0]?.session?.status).toBe("running");
    expect(threadsOf(next)[0]?.latestTurn?.state).toBe("running");
    expect(threadsOf(next)[0]?.latestTurn?.completedAt).toBeNull();
    expect(threadsOf(next)[0]?.messages).toHaveLength(1);

    const settled = applyOrchestrationEvents(
      next,
      [
        makeEvent(
          "thread.session-set",
          {
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "ready",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2026-02-27T00:00:04.000Z",
            },
          },
          { sequence: 4 },
        ),
      ],
      localEnvironmentId,
    );

    expect(threadsOf(settled)[0]?.latestTurn?.state).toBe("completed");
    expect(threadsOf(settled)[0]?.latestTurn?.completedAt).toBe("2026-02-27T00:00:04.000Z");
  });

  it("clears a PM running indicator when a tool-only turn settles without assistant text", () => {
    const thread = makeThread({
      id: ThreadId.make("pm:project-1"),
      latestTurn: {
        turnId: TurnId.make("pm-turn-1"),
        state: "running",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const state = makeState(thread);

    const settled = applyOrchestrationEvent(
      state,
      makeEvent("thread.session-set", {
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "ready",
          providerName: "claudeAgent",
          providerInstanceId: ProviderInstanceId.make("claudeAgent"),
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:04.000Z",
        },
      }),
      localEnvironmentId,
    );

    expect(threadsOf(settled)[0]?.latestTurn?.state).toBe("completed");
    expect(threadsOf(settled)[0]?.latestTurn?.completedAt).toBe("2026-02-27T00:00:04.000Z");
    expect(threadsOf(settled)[0]?.latestTurn?.assistantMessageId).toBeNull();
  });

  it("does not regress latestTurn when an older turn diff completes late", () => {
    const state = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.make("turn-2"),
          state: "running",
          requestedAt: "2026-02-27T00:00:02.000Z",
          startedAt: "2026-02-27T00:00:03.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-diff-completed", {
        threadId: ThreadId.make("thread-1"),
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.make("assistant-1"),
        completedAt: "2026-02-27T00:00:04.000Z",
      }),
      localEnvironmentId,
    );

    expect(threadsOf(next)[0]?.turnDiffSummaries).toHaveLength(1);
    expect(threadsOf(next)[0]?.latestTurn).toEqual(threadsOf(state)[0]?.latestTurn);
  });

  it("rebinds live turn diffs to the authoritative assistant message when it arrives later", () => {
    const turnId = TurnId.make("turn-1");
    const state = makeState(
      makeThread({
        latestTurn: {
          turnId,
          state: "completed",
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:02.000Z",
          assistantMessageId: MessageId.make("assistant:turn-1"),
        },
        turnDiffSummaries: [
          {
            turnId,
            completedAt: "2026-02-27T00:00:02.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("checkpoint-1"),
            assistantMessageId: MessageId.make("assistant:turn-1"),
            files: [{ path: "src/app.ts", additions: 1, deletions: 0 }],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.message-sent", {
        threadId: ThreadId.make("thread-1"),
        messageId: MessageId.make("assistant-real"),
        role: "assistant",
        text: "final answer",
        turnId,
        streaming: false,
        createdAt: "2026-02-27T00:00:03.000Z",
        updatedAt: "2026-02-27T00:00:03.000Z",
      }),
      localEnvironmentId,
    );

    expect(threadsOf(next)[0]?.turnDiffSummaries[0]?.assistantMessageId).toBe(
      MessageId.make("assistant-real"),
    );
    expect(threadsOf(next)[0]?.latestTurn?.assistantMessageId).toBe(
      MessageId.make("assistant-real"),
    );
  });

  it("reverts messages, plans, activities, and checkpoints by retained turns", () => {
    const state = makeState(
      makeThread({
        messages: [
          {
            id: MessageId.make("user-1"),
            role: "user",
            text: "first",
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
            completedAt: "2026-02-27T00:00:00.000Z",
            streaming: false,
          },
          {
            id: MessageId.make("assistant-1"),
            role: "assistant",
            text: "first reply",
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-02-27T00:00:01.000Z",
            completedAt: "2026-02-27T00:00:01.000Z",
            streaming: false,
          },
          {
            id: MessageId.make("user-2"),
            role: "user",
            text: "second",
            turnId: TurnId.make("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
            completedAt: "2026-02-27T00:00:02.000Z",
            streaming: false,
          },
        ],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "plan 1",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: "plan-2",
            turnId: TurnId.make("turn-2"),
            planMarkdown: "plan 2",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-27T00:00:02.000Z",
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        activities: [
          {
            id: EventId.make("activity-1"),
            tone: "info",
            kind: "step",
            summary: "one",
            payload: {},
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: EventId.make("activity-2"),
            tone: "info",
            kind: "step",
            summary: "two",
            payload: {},
            turnId: TurnId.make("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        turnDiffSummaries: [
          {
            turnId: TurnId.make("turn-1"),
            completedAt: "2026-02-27T00:00:01.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("ref-1"),
            files: [],
          },
          {
            turnId: TurnId.make("turn-2"),
            completedAt: "2026-02-27T00:00:03.000Z",
            status: "ready",
            checkpointTurnCount: 2,
            checkpointRef: CheckpointRef.make("ref-2"),
            files: [],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.reverted", {
        threadId: ThreadId.make("thread-1"),
        turnCount: 1,
      }),
      localEnvironmentId,
    );

    expect(threadsOf(next)[0]?.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(threadsOf(next)[0]?.proposedPlans.map((plan) => plan.id)).toEqual(["plan-1"]);
    expect(threadsOf(next)[0]?.activities.map((activity) => activity.id)).toEqual([
      EventId.make("activity-1"),
    ]);
    expect(threadsOf(next)[0]?.turnDiffSummaries.map((summary) => summary.turnId)).toEqual([
      TurnId.make("turn-1"),
    ]);
  });

  it("settles a running turn when turn-interrupt-requested arrives without a turnId", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "running",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const state = makeState(thread);

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-interrupt-requested", {
        threadId: thread.id,
        createdAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(threadsOf(next)[0]?.latestTurn?.state).toBe("interrupted");
    expect(threadsOf(next)[0]?.latestTurn?.turnId).toBe(TurnId.make("turn-1"));
    expect(threadsOf(next)[0]?.latestTurn?.completedAt).toBe("2026-02-27T00:00:01.000Z");
  });

  it("leaves thread unchanged when turn-interrupt-requested without turnId arrives with no latestTurn", () => {
    const thread = makeThread({ latestTurn: null });
    const state = makeState(thread);

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-interrupt-requested", {
        threadId: thread.id,
        createdAt: "2026-02-27T00:00:01.000Z",
      }),
      localEnvironmentId,
    );

    expect(next).toBe(state);
  });

  it("does not regress an already-settled turn when turn-interrupt-requested arrives without a turnId", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: "2026-02-27T00:00:01.000Z",
        assistantMessageId: null,
      },
    });
    const state = makeState(thread);

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-interrupt-requested", {
        threadId: thread.id,
        createdAt: "2026-02-27T00:00:02.000Z",
      }),
      localEnvironmentId,
    );

    expect(next).toBe(state);
  });

  it("settles only the matching turn when turn-interrupt-requested arrives with a turnId", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.make("turn-2"),
        state: "running",
        requestedAt: "2026-02-27T00:00:02.000Z",
        startedAt: "2026-02-27T00:00:02.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const state = makeState(thread);

    // interrupt for a different turnId — should not change latestTurn
    const nextMismatch = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-interrupt-requested", {
        threadId: thread.id,
        turnId: TurnId.make("turn-1"),
        createdAt: "2026-02-27T00:00:03.000Z",
      }),
      localEnvironmentId,
    );
    expect(nextMismatch).toBe(state);

    // interrupt for the matching turnId — should settle
    const nextMatch = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-interrupt-requested", {
        threadId: thread.id,
        turnId: TurnId.make("turn-2"),
        createdAt: "2026-02-27T00:00:03.000Z",
      }),
      localEnvironmentId,
    );
    expect(threadsOf(nextMatch)[0]?.latestTurn?.state).toBe("interrupted");
    expect(threadsOf(nextMatch)[0]?.latestTurn?.turnId).toBe(TurnId.make("turn-2"));
  });

  it("clears pending source proposed plans after revert before a new session-set event", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.make("turn-2"),
        state: "completed",
        requestedAt: "2026-02-27T00:00:02.000Z",
        startedAt: "2026-02-27T00:00:02.000Z",
        completedAt: "2026-02-27T00:00:03.000Z",
        assistantMessageId: MessageId.make("assistant-2"),
        sourceProposedPlan: {
          threadId: ThreadId.make("thread-source"),
          planId: "plan-2" as never,
        },
      },
      pendingSourceProposedPlan: {
        threadId: ThreadId.make("thread-source"),
        planId: "plan-2" as never,
      },
      turnDiffSummaries: [
        {
          turnId: TurnId.make("turn-1"),
          completedAt: "2026-02-27T00:00:01.000Z",
          status: "ready",
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("ref-1"),
          files: [],
        },
        {
          turnId: TurnId.make("turn-2"),
          completedAt: "2026-02-27T00:00:03.000Z",
          status: "ready",
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.make("ref-2"),
          files: [],
        },
      ],
    });
    const reverted = applyOrchestrationEvent(
      makeState(thread),
      makeEvent("thread.reverted", {
        threadId: thread.id,
        turnCount: 1,
      }),
      localEnvironmentId,
    );

    expect(threadsOf(reverted)[0]?.pendingSourceProposedPlan).toBeUndefined();

    const next = applyOrchestrationEvent(
      reverted,
      makeEvent("thread.session-set", {
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-3"),
          lastError: null,
          updatedAt: "2026-02-27T00:00:04.000Z",
        },
      }),
      localEnvironmentId,
    );

    expect(threadsOf(next)[0]?.latestTurn).toMatchObject({
      turnId: TurnId.make("turn-3"),
      state: "running",
    });
    expect(threadsOf(next)[0]?.latestTurn?.sourceProposedPlan).toBeUndefined();
  });
});

describe("incremental slice characterization (plan 012 contract)", () => {
  it("produces correct messages, activities, and derived slices after a mixed event sequence", () => {
    const thread = makeThread();
    const state = makeState(thread);
    const threadId = thread.id;

    // Apply a mixed sequence:
    // 1. New user message
    // 2. New streaming assistant message (message-2)
    // 3. Streaming delta appended to same message-2
    // 4. activity-appended (activity-a)
    // 5. activity-appended (activity-b, older createdAt — out-of-order)
    // 6. activity-appended (activity-a again — replace/re-send)
    // 7. Final non-streaming update to message-2
    const events: OrchestrationEvent[] = [
      makeEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.make("message-1"),
          role: "user",
          text: "hello",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        { sequence: 1 },
      ),
      makeEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.make("message-2"),
          role: "assistant",
          text: "hello",
          turnId: TurnId.make("turn-1"),
          streaming: true,
          createdAt: "2026-03-01T00:00:01.000Z",
          updatedAt: "2026-03-01T00:00:01.000Z",
        },
        { sequence: 2 },
      ),
      makeEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.make("message-2"),
          role: "assistant",
          text: " world",
          turnId: TurnId.make("turn-1"),
          streaming: true,
          createdAt: "2026-03-01T00:00:01.000Z",
          updatedAt: "2026-03-01T00:00:02.000Z",
        },
        { sequence: 3 },
      ),
      makeEvent(
        "thread.activity-appended",
        {
          threadId,
          activity: {
            id: EventId.make("activity-a"),
            tone: "info",
            kind: "step",
            summary: "step A v1",
            payload: {},
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-03-01T00:00:01.500Z",
          },
        },
        { sequence: 4 },
      ),
      makeEvent(
        "thread.activity-appended",
        {
          threadId,
          activity: {
            id: EventId.make("activity-b"),
            tone: "info",
            kind: "step",
            summary: "step B (earlier)",
            payload: {},
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-03-01T00:00:01.000Z",
          },
        },
        { sequence: 5 },
      ),
      makeEvent(
        "thread.activity-appended",
        {
          threadId,
          activity: {
            id: EventId.make("activity-a"),
            tone: "info",
            kind: "step",
            summary: "step A v2 (resent)",
            payload: {},
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-03-01T00:00:01.500Z",
          },
        },
        { sequence: 6 },
      ),
      makeEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.make("message-2"),
          role: "assistant",
          text: "hello world done",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-03-01T00:00:01.000Z",
          updatedAt: "2026-03-01T00:00:03.000Z",
        },
        { sequence: 7 },
      ),
    ];

    const finalState = applyOrchestrationEvents(state, events, localEnvironmentId);
    const envState = localEnvironmentStateOf(finalState);
    const thread1 = threadsOf(finalState)[0]!;

    // --- messages ---
    // message-1: user "hello" (non-streaming, kept as-is)
    // message-2: assistant, final non-streaming text "hello world done" (replaces streaming)
    expect(thread1.messages).toHaveLength(2);
    expect(thread1.messages[0]?.id).toBe(MessageId.make("message-1"));
    expect(thread1.messages[0]?.text).toBe("hello");
    expect(thread1.messages[0]?.streaming).toBe(false);
    expect(thread1.messages[1]?.id).toBe(MessageId.make("message-2"));
    expect(thread1.messages[1]?.text).toBe("hello world done");
    expect(thread1.messages[1]?.streaming).toBe(false);

    // --- activities ---
    // sorted by createdAt asc: activity-b (00:00:01.000Z) < activity-a (00:00:01.500Z)
    expect(thread1.activities).toHaveLength(2);
    expect(thread1.activities[0]?.id).toBe(EventId.make("activity-b"));
    expect(thread1.activities[1]?.id).toBe(EventId.make("activity-a"));
    expect(thread1.activities[1]?.summary).toBe("step A v2 (resent)");

    // --- derived message slice ---
    expect(envState.messageIdsByThreadId[threadId]).toEqual([
      MessageId.make("message-1"),
      MessageId.make("message-2"),
    ]);
    expect(envState.messageByThreadId[threadId]?.[MessageId.make("message-1")]?.text).toBe("hello");
    expect(envState.messageByThreadId[threadId]?.[MessageId.make("message-2")]?.text).toBe(
      "hello world done",
    );

    // --- derived activity slice ---
    expect(envState.activityIdsByThreadId[threadId]).toEqual([
      EventId.make("activity-b"),
      EventId.make("activity-a"),
    ]);
    expect(envState.activityByThreadId[threadId]?.[EventId.make("activity-a")]?.summary).toBe(
      "step A v2 (resent)",
    );
    expect(envState.activityByThreadId[threadId]?.[EventId.make("activity-b")]?.summary).toBe(
      "step B (earlier)",
    );
  });

  it("keeps the derived activity slice capped when appending past MAX_THREAD_ACTIVITIES", () => {
    const thread = makeThread();
    const state = makeState(thread);
    const threadId = thread.id;

    // MAX_THREAD_ACTIVITIES (500) is not exported; append one past it so the
    // canonical thread.activities is front-truncated. The incremental
    // tail-append fast path must fall back to a full rebuild instead of
    // appending unbounded ids and leaving a stale byId entry.
    const cap = 500;
    const total = cap + 1;
    const events: OrchestrationEvent[] = Array.from({ length: total }, (_, i) =>
      makeEvent(
        "thread.activity-appended",
        {
          threadId,
          activity: {
            id: EventId.make(`activity-${String(i).padStart(4, "0")}`),
            tone: "info",
            kind: "step",
            summary: `step ${i}`,
            payload: {},
            turnId: TurnId.make("turn-1"),
            // Strictly increasing createdAt → every event is a tail-append,
            // which is exactly the incremental hint path under test.
            createdAt: new Date(Date.UTC(2026, 2, 1) + i * 1000).toISOString(),
          },
        },
        { sequence: i + 1 },
      ),
    );

    const finalState = applyOrchestrationEvents(state, events, localEnvironmentId);
    const envState = localEnvironmentStateOf(finalState);
    const thread1 = threadsOf(finalState)[0]!;

    // Canonical activities are capped to the most recent `cap` entries.
    expect(thread1.activities).toHaveLength(cap);

    // The derived slice must match the canonical activities exactly — no extra
    // (uncapped) ids and no stale byId entry for the dropped-oldest activity.
    const derivedIds = envState.activityIdsByThreadId[threadId];
    expect(derivedIds).toHaveLength(cap);
    expect(derivedIds).toEqual(thread1.activities.map((activity) => activity.id));
    expect(Object.keys(envState.activityByThreadId[threadId] ?? {})).toHaveLength(cap);

    // The oldest activity (index 0) was front-truncated and must not linger.
    const droppedId = EventId.make("activity-0000");
    expect(derivedIds).not.toContain(droppedId);
    expect(envState.activityByThreadId[threadId]?.[droppedId]).toBeUndefined();

    // The newest activity is retained at the tail of both views.
    const newestId = EventId.make(`activity-${String(total - 1).padStart(4, "0")}`);
    expect(thread1.activities[thread1.activities.length - 1]?.id).toBe(newestId);
    expect(derivedIds).toContain(newestId);
  });
});

describe("orchestrator stage history", () => {
  const projectId = ProjectId.make("sh-project");
  const taskId = TaskId.make("sh-task");
  const planThreadId = ThreadId.make("sh-stage-plan");
  const workThreadId = ThreadId.make("sh-stage-work");
  const taskRef = { environmentId: localEnvironmentId, taskId };
  const codex = ProviderInstanceId.make("codex_plan");
  const claude = ProviderInstanceId.make("claude_work");

  function seedProjectAndTask(): AppState {
    return applyOrchestrationEvents(
      makeEmptyState({ activeEnvironmentId: localEnvironmentId }),
      [
        makeEvent(
          "project.created",
          {
            projectId,
            title: "Stage History",
            workspaceRoot: "/tmp/sh",
            defaultModelSelection: { instanceId: codex, model: DEFAULT_MODEL },
            scripts: [],
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
          { sequence: 1, aggregateKind: "project", aggregateId: projectId },
        ),
        makeEvent(
          "task.created",
          {
            taskId,
            projectId,
            taskType: TaskTypeId.make("feature"),
            title: "Build the timeline",
            branch: "orchestrator/sh-task",
            worktreePath: "/tmp/sh/wt",
            pmMessageId: MessageId.make("sh-pm-msg"),
            playbookVersion: "feature@v1",
            createdAt: "2026-06-01T00:00:01.000Z",
            updatedAt: "2026-06-01T00:00:01.000Z",
          },
          { sequence: 2, aggregateKind: "task", aggregateId: taskId },
        ),
      ],
      localEnvironmentId,
    );
  }

  it("records running, completed, and blocked stages from streamed events in start order", () => {
    let state = seedProjectAndTask();

    state = applyOrchestrationEvent(
      state,
      makeEvent(
        "task.stage-started",
        {
          taskId,
          role: "plan",
          stageThreadId: planThreadId,
          awaitedTurnId: null,
          providerInstanceId: codex,
          model: "gpt-5-plan",
          updatedAt: "2026-06-01T00:00:02.000Z",
        },
        { sequence: 3, aggregateKind: "task", aggregateId: taskId },
      ),
      localEnvironmentId,
    );

    const afterPlanStart = selectTaskStageHistoryByRef(state, taskRef);
    expect(afterPlanStart).toHaveLength(1);
    expect(afterPlanStart[0]).toMatchObject({
      role: "plan",
      status: "running",
      providerInstanceId: codex,
      model: "gpt-5-plan",
      endedAt: null,
    });

    state = applyOrchestrationEvent(
      state,
      makeEvent(
        "task.stage-completed",
        {
          taskId,
          role: "plan",
          stageThreadId: planThreadId,
          awaitedTurnId: null,
          updatedAt: "2026-06-01T00:00:03.000Z",
        },
        { sequence: 4, aggregateKind: "task", aggregateId: taskId },
      ),
      localEnvironmentId,
    );

    expect(selectTaskStageHistoryByRef(state, taskRef)[0]).toMatchObject({
      role: "plan",
      status: "completed",
      endedAt: "2026-06-01T00:00:03.000Z",
    });

    state = applyOrchestrationEvent(
      state,
      makeEvent(
        "task.stage-started",
        {
          taskId,
          role: "work",
          stageThreadId: workThreadId,
          awaitedTurnId: null,
          providerInstanceId: claude,
          model: "claude-opus-work",
          updatedAt: "2026-06-01T00:00:04.000Z",
        },
        { sequence: 5, aggregateKind: "task", aggregateId: taskId },
      ),
      localEnvironmentId,
    );

    state = applyOrchestrationEvent(
      state,
      makeEvent(
        "task.stage-blocked",
        {
          taskId,
          role: "work",
          stageThreadId: workThreadId,
          reason: "quota",
          providerInstanceId: claude,
          updatedAt: "2026-06-01T00:00:05.000Z",
        },
        { sequence: 6, aggregateKind: "task", aggregateId: taskId },
      ),
      localEnvironmentId,
    );

    const stages = selectTaskStageHistoryByRef(state, taskRef);
    expect(stages.map((stage) => stage.role)).toEqual(["plan", "work"]);
    expect(stages[1]).toMatchObject({
      role: "work",
      status: "blocked",
      providerInstanceId: claude,
      endedAt: "2026-06-01T00:00:05.000Z",
    });
  });

  it("settles an orphaned streamed stage as interrupted without adding a quota block", () => {
    let state = seedProjectAndTask();
    state = applyOrchestrationEvent(
      state,
      makeEvent(
        "task.stage-started",
        {
          taskId,
          role: "work",
          stageThreadId: workThreadId,
          awaitedTurnId: TurnId.make("turn-orphaned"),
          providerInstanceId: codex,
          model: "gpt-5-codex",
          updatedAt: "2026-07-11T01:00:00.000Z",
        },
        { sequence: 3, aggregateKind: "task", aggregateId: taskId },
      ),
      localEnvironmentId,
    );
    state = applyOrchestrationEvent(
      state,
      makeEvent(
        "task.stage-interrupted",
        {
          taskId,
          role: "work",
          stageThreadId: workThreadId,
          reason: "orphaned",
          updatedAt: "2026-07-11T01:01:00.000Z",
        },
        { sequence: 4, aggregateKind: "task", aggregateId: taskId },
      ),
      localEnvironmentId,
    );

    expect(selectTaskByRef(state, taskRef)).toMatchObject({
      status: "blocked",
      currentStageThreadId: null,
    });
    expect(selectTaskStageHistoryByRef(state, taskRef)[0]).toMatchObject({
      status: "interrupted",
      endedAt: "2026-07-11T01:01:00.000Z",
    });
    expect(selectEnvironmentState(state, localEnvironmentId).quotaBlockedStageByTaskId).toEqual({});
  });

  it("seeds stage history from the project snapshot and resets stale rows", () => {
    const seeded = seedProjectAndTask();
    const task = selectTaskByRef(seeded, taskRef);
    if (task === undefined) {
      throw new Error("expected the seeded task to exist");
    }

    const entry: OrchestrationStageHistoryEntry = {
      projectId,
      taskId,
      stageThreadId: planThreadId,
      role: "plan",
      capabilityTier: null,
      providerInstanceId: codex,
      model: "gpt-5-plan",
      modelOptions: null,
      status: "completed",
      startedAt: "2026-06-01T00:00:02.000Z",
      endedAt: "2026-06-01T00:00:03.000Z",
    };

    const snapshotWith = (stageHistory: Record<string, OrchestrationStageHistoryEntry>): AppState =>
      syncOrchestratorProjectSnapshot(
        seeded,
        {
          snapshotSequence: 10,
          project: {
            id: projectId,
            title: "Stage History",
            workspaceRoot: "/tmp/sh",
            defaultModelSelection: { instanceId: codex, model: DEFAULT_MODEL },
            scripts: [],
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            deletedAt: null,
          },
          pmThreadId: ThreadId.make("pm:sh-project"),
          pmThread: null,
          pmQuotaBlock: null,
          tasks: [task],
          pendingGates: [],
          quotaBlockedStages: [],
          stageHistory,
        },
        localEnvironmentId,
      );

    const seededState = snapshotWith({ [String(planThreadId)]: entry });
    expect(selectTaskStageHistoryByRef(seededState, taskRef)).toEqual([entry]);

    const resetState = snapshotWith({});
    expect(selectTaskStageHistoryByRef(resetState, taskRef)).toEqual([]);
  });
});
