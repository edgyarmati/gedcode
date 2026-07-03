import { QueryClient } from "@tanstack/react-query";
import {
  EnvironmentId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationShellSnapshot,
  type OrchestratorProjectDetailSnapshot,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSubscribeThread = vi.fn();
const mockSubscribeProject = vi.fn();
const mockSubscribeTask = vi.fn();
const mockThreadUnsubscribe = vi.fn();
const mockProjectUnsubscribe = vi.fn();
const mockTaskUnsubscribe = vi.fn();
const mockCreateEnvironmentConnection = vi.fn();
const mockCreateWsRpcClient = vi.fn();
const mockWaitForSavedEnvironmentRegistryHydration = vi.fn();
const mockListSavedEnvironmentRecords = vi.fn();
const mockGetSavedEnvironmentRecord = vi.fn();
const mockReadSavedEnvironmentBearerToken = vi.fn();
const mockSavedEnvironmentRegistrySubscribe = vi.fn();
const mockGetPrimaryKnownEnvironment = vi.hoisted(() => vi.fn());
const mockFetchRemoteSessionState = vi.fn();
const mockConnectionReconnects: Array<ReturnType<typeof vi.fn>> = [];
let savedEnvironmentRegistryListener: (() => void) | null = null;

function MockWsTransport() {
  return undefined;
}

vi.mock("../primary", () => ({
  getPrimaryKnownEnvironment: mockGetPrimaryKnownEnvironment,
}));

vi.mock("../remote/api", () => ({
  bootstrapRemoteBearerSession: vi.fn(),
  fetchRemoteEnvironmentDescriptor: vi.fn(),
  fetchRemoteSessionState: mockFetchRemoteSessionState,
  isRemoteEnvironmentAuthHttpError: vi.fn(() => false),
  resolveRemoteWebSocketConnectionUrl: vi.fn(async () => "ws://remote.example.test/ws"),
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: mockGetSavedEnvironmentRecord,
  hasSavedEnvironmentRegistryHydrated: vi.fn(() => true),
  listSavedEnvironmentRecords: mockListSavedEnvironmentRecords,
  persistSavedEnvironmentRecord: vi.fn(),
  readSavedEnvironmentBearerToken: mockReadSavedEnvironmentBearerToken,
  removeSavedEnvironmentBearerToken: vi.fn(),
  useSavedEnvironmentRegistryStore: {
    subscribe: mockSavedEnvironmentRegistrySubscribe,
    getState: () => ({
      upsert: vi.fn(),
      remove: vi.fn(),
      markConnected: vi.fn(),
      rename: vi.fn(),
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      ensure: vi.fn(),
      patch: vi.fn(),
      clear: vi.fn(),
    }),
  },
  waitForSavedEnvironmentRegistryHydration: mockWaitForSavedEnvironmentRegistryHydration,
  writeSavedEnvironmentBearerToken: vi.fn(),
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("../../rpc/wsRpcClient", () => ({
  createWsRpcClient: mockCreateWsRpcClient,
}));

vi.mock("../../rpc/wsTransport", () => ({
  WsTransport: MockWsTransport,
}));

function makeThreadShellSnapshot(params: {
  readonly threadId: ThreadId;
  readonly sessionStatus?:
    | "idle"
    | "starting"
    | "running"
    | "ready"
    | "interrupted"
    | "stopped"
    | "error";
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly hasActionableProposedPlan?: boolean;
}): OrchestrationShellSnapshot {
  const projectId = ProjectId.make("project-1");
  const turnId = TurnId.make("turn-1");

  return {
    snapshotSequence: 1,
    projects: [],
    updatedAt: "2026-04-13T00:00:00.000Z",
    threads: [
      {
        id: params.threadId,
        projectId,
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn:
          params.sessionStatus === "running"
            ? {
                turnId,
                state: "running",
                requestedAt: "2026-04-13T00:00:00.000Z",
                startedAt: "2026-04-13T00:00:01.000Z",
                completedAt: null,
                assistantMessageId: null,
              }
            : null,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        archivedAt: null,
        session: params.sessionStatus
          ? {
              threadId: params.threadId,
              status: params.sessionStatus,
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: params.sessionStatus === "running" ? turnId : null,
              lastError: null,
              updatedAt: "2026-04-13T00:00:00.000Z",
            }
          : null,
        latestUserMessageAt: null,
        hasPendingApprovals: params.hasPendingApprovals ?? false,
        hasPendingUserInput: params.hasPendingUserInput ?? false,
        hasActionableProposedPlan: params.hasActionableProposedPlan ?? false,
      },
    ],
  };
}

function makeThreadDetail(params: {
  readonly threadId: ThreadId;
  readonly projectId?: ProjectId;
  readonly messages?: OrchestrationThread["messages"];
  readonly activities?: OrchestrationThreadActivity[];
}): OrchestrationThread {
  return {
    id: params.threadId,
    projectId: params.projectId ?? ProjectId.make("project-1"),
    title: "PM Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("claude"),
      model: "claude-sonnet-4",
    },
    gedWorkflowEnabled: false,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: "/tmp/project",
    latestTurn: null,
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: params.messages ?? [],
    proposedPlans: [],
    activities: params.activities ?? [],
    checkpoints: [],
    session: null,
  };
}

function makeProjectDetailSnapshot(params: {
  readonly projectId: ProjectId;
  readonly pmThread: OrchestrationThread | null;
  readonly snapshotSequence: number;
}): OrchestratorProjectDetailSnapshot {
  return {
    snapshotSequence: params.snapshotSequence,
    project: {
      id: params.projectId,
      title: "Project",
      workspaceRoot: "/tmp/project",
      repositoryIdentity: null,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      roleModelSelections: {},
      rolePromptPrefixes: {},
      orchestratorConfig: {
        enabled: true,
        pmModelSelection: {
          instanceId: ProviderInstanceId.make("claude"),
          model: "claude-sonnet-4",
        },
      },
      scripts: [],
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
      deletedAt: null,
    },
    pmThreadId: ThreadId.make(`pm:${params.projectId}`),
    pmThread: params.pmThread,
    pmQuotaBlock: null,
    tasks: [],
    pendingGates: [],
    quotaBlockedStages: [],
    stageHistory: {},
  };
}

function makeThreadEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  sequence: number,
): Extract<OrchestrationEvent, { type: T }> {
  const threadId = "threadId" in payload ? payload.threadId : ThreadId.make("thread-unknown");
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: `2026-04-13T00:00:0${sequence}.000Z`,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as Extract<OrchestrationEvent, { type: T }>;
}

function makeToolActivity(params: {
  readonly id: string;
  readonly kind: "tool.updated" | "tool.completed";
  readonly status?: "inProgress" | "completed";
  readonly createdAt: string;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(params.id),
    tone: "tool",
    kind: params.kind,
    summary: params.kind === "tool.completed" ? "Worker for task completed" : "Worker for task",
    payload: {
      itemType: "dynamic_tool_call",
      title: "Worker for task",
      status: params.status,
      data: {
        toolCallId: "worker-call-1",
      },
    },
    turnId: null,
    createdAt: params.createdAt,
  };
}

describe("retainThreadDetailSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mockGetPrimaryKnownEnvironment.mockReturnValue({
      id: "env-1",
      label: "Primary environment",
      source: "window-origin",
      target: {
        httpBaseUrl: "http://127.0.0.1:3000/",
        wsBaseUrl: "ws://127.0.0.1:3000/",
      },
      environmentId: EnvironmentId.make("env-1"),
    });

    mockThreadUnsubscribe.mockImplementation(() => undefined);
    mockProjectUnsubscribe.mockImplementation(() => undefined);
    mockTaskUnsubscribe.mockImplementation(() => undefined);
    mockSubscribeThread.mockImplementation(() => mockThreadUnsubscribe);
    mockSubscribeProject.mockImplementation(() => mockProjectUnsubscribe);
    mockSubscribeTask.mockImplementation(() => mockTaskUnsubscribe);
    mockCreateWsRpcClient.mockReturnValue({
      server: {
        getConfig: vi.fn(async () => ({
          environment: {
            environmentId: EnvironmentId.make("env-remote"),
            label: "Remote env",
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          },
        })),
      },
      isHeartbeatFresh: vi.fn(() => true),
      orchestration: {
        subscribeThread: mockSubscribeThread,
      },
      orchestrator: {
        subscribeProject: mockSubscribeProject,
        subscribeTask: mockSubscribeTask,
        setTaskRoleSelections: vi.fn(),
        cancelTask: vi.fn(),
        clearPmChat: vi.fn(),
      },
    });
    mockCreateEnvironmentConnection.mockImplementation((input) => {
      const reconnect = vi.fn(async () => undefined);
      mockConnectionReconnects.push(reconnect);
      return {
        kind: input.kind,
        environmentId: input.knownEnvironment.environmentId,
        knownEnvironment: input.knownEnvironment,
        client: input.client,
        ensureBootstrapped: vi.fn(async () => undefined),
        reconnect,
        dispose: vi.fn(async () => undefined),
      };
    });
    savedEnvironmentRegistryListener = null;
    mockSavedEnvironmentRegistrySubscribe.mockImplementation((listener: () => void) => {
      savedEnvironmentRegistryListener = listener;
      return () => {
        if (savedEnvironmentRegistryListener === listener) {
          savedEnvironmentRegistryListener = null;
        }
      };
    });
    mockWaitForSavedEnvironmentRegistryHydration.mockResolvedValue(undefined);
    mockListSavedEnvironmentRecords.mockReturnValue([]);
    mockGetSavedEnvironmentRecord.mockReturnValue(null);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue(null);
    mockFetchRemoteSessionState.mockResolvedValue({
      authenticated: true,
      role: "client",
    });
    mockConnectionReconnects.length = 0;
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps thread detail subscriptions warm across releases until idle eviction", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-1");

    const releaseFirst = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    const releaseSecond = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(28 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("retains a live PM user message when a stale thread snapshot arrives later", async () => {
    const {
      retainOrchestratorProjectSubscription,
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");
    const { selectThreadByRef, useStore } = await import("../../store");
    const { scopeThreadRef } = await import("@t3tools/client-runtime");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const projectId = ProjectId.make("project-live-user");
    const threadId = ThreadId.make(`pm:${projectId}`);
    const releaseProject = retainOrchestratorProjectSubscription(environmentId, projectId);
    const release = retainThreadDetailSubscription(environmentId, threadId);
    const onThreadItem = mockSubscribeThread.mock.calls[0]?.[1];
    const onProjectItem = mockSubscribeProject.mock.calls[0]?.[1];
    expect(onThreadItem).toBeTypeOf("function");
    expect(onProjectItem).toBeTypeOf("function");

    const emptyThread = makeThreadDetail({ threadId, projectId });
    onThreadItem({
      kind: "snapshot",
      snapshot: { snapshotSequence: 1, thread: emptyThread },
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.make("pm-user-1"),
          role: "user",
          text: "Start the worker.",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: "2026-04-13T00:00:02.000Z",
          updatedAt: "2026-04-13T00:00:02.000Z",
        },
        2,
      ),
    });
    onThreadItem({
      kind: "snapshot",
      snapshot: { snapshotSequence: 1, thread: emptyThread },
    });
    onProjectItem({
      kind: "snapshot",
      snapshot: makeProjectDetailSnapshot({
        projectId,
        pmThread: emptyThread,
        snapshotSequence: 1,
      }),
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.make("pm-assistant-1"),
          role: "assistant",
          text: "Worker started.",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-13T00:00:03.000Z",
          updatedAt: "2026-04-13T00:00:03.000Z",
        },
        3,
      ),
    });

    const thread = selectThreadByRef(useStore.getState(), scopeThreadRef(environmentId, threadId));
    expect(thread?.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "Start the worker."],
      ["assistant", "Worker started."],
    ]);

    release();
    releaseProject();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("applies the first PM message after an empty placeholder snapshot", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");
    const { selectThreadByRef, useStore } = await import("../../store");
    const { scopeThreadRef } = await import("@t3tools/client-runtime");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const projectId = ProjectId.make("project-first-message");
    const threadId = ThreadId.make(`pm:${projectId}`);
    const release = retainThreadDetailSubscription(environmentId, threadId);
    const onThreadItem = mockSubscribeThread.mock.calls[0]?.[1];
    expect(onThreadItem).toBeTypeOf("function");

    onThreadItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        thread: makeThreadDetail({ threadId, projectId }),
      },
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.created",
        {
          threadId,
          projectId,
          title: "Project PM",
          modelSelection: {
            instanceId: ProviderInstanceId.make("claude"),
            model: "claude-sonnet-4",
          },
          gedWorkflowEnabled: false,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: "/tmp/project",
          createdAt: "2026-04-13T00:00:02.000Z",
          updatedAt: "2026-04-13T00:00:02.000Z",
        },
        2,
      ),
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.message-sent",
        {
          threadId,
          messageId: MessageId.make("pm-user-first"),
          role: "user",
          text: "Start.",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: "2026-04-13T00:00:03.000Z",
          updatedAt: "2026-04-13T00:00:03.000Z",
        },
        3,
      ),
    });

    const thread = selectThreadByRef(useStore.getState(), scopeThreadRef(environmentId, threadId));
    expect(thread?.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "Start."],
    ]);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("does not drop PM streaming deltas when a snapshot watermark is ahead of message freshness", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");
    const { selectThreadByRef, useStore } = await import("../../store");
    const { scopeThreadRef } = await import("@t3tools/client-runtime");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const projectId = ProjectId.make("project-streaming");
    const threadId = ThreadId.make(`pm:${projectId}`);
    const messageId = MessageId.make("pm-assistant-stream");
    const release = retainThreadDetailSubscription(environmentId, threadId);
    const onThreadItem = mockSubscribeThread.mock.calls[0]?.[1];
    expect(onThreadItem).toBeTypeOf("function");

    onThreadItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 10,
        thread: makeThreadDetail({
          threadId,
          projectId,
          messages: [
            {
              id: messageId,
              role: "assistant",
              text: "Hello ",
              turnId: TurnId.make("pm-turn-1"),
              streaming: true,
              createdAt: "2026-04-13T00:00:02.000Z",
              updatedAt: "2026-04-13T00:00:02.000Z",
            },
          ],
        }),
      },
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.message-sent",
        {
          threadId,
          messageId,
          role: "assistant",
          text: "world",
          turnId: TurnId.make("pm-turn-1"),
          streaming: true,
          createdAt: "2026-04-13T00:00:02.000Z",
          updatedAt: "2026-04-13T00:00:03.000Z",
        },
        8,
      ),
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.message-sent",
        {
          threadId,
          messageId,
          role: "assistant",
          text: "Hello ",
          turnId: TurnId.make("pm-turn-1"),
          streaming: true,
          createdAt: "2026-04-13T00:00:02.000Z",
          updatedAt: "2026-04-13T00:00:02.000Z",
        },
        7,
      ),
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.message-sent",
        {
          threadId,
          messageId,
          role: "assistant",
          text: "",
          turnId: TurnId.make("pm-turn-1"),
          streaming: false,
          createdAt: "2026-04-13T00:00:02.000Z",
          updatedAt: "2026-04-13T00:00:04.000Z",
        },
        11,
      ),
    });

    const thread = selectThreadByRef(useStore.getState(), scopeThreadRef(environmentId, threadId));
    expect(thread?.messages[0]?.text).toBe("Hello world");
    expect(thread?.messages[0]?.streaming).toBe(false);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("retains a live completed worker activity when a stale in-progress snapshot arrives later", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");
    const { selectThreadByRef, useStore } = await import("../../store");
    const { scopeThreadRef } = await import("@t3tools/client-runtime");
    const { deriveWorkLogEntries } = await import("../../session-logic");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("pm:project-live-activity");
    const release = retainThreadDetailSubscription(environmentId, threadId);
    const onThreadItem = mockSubscribeThread.mock.calls[0]?.[1];
    expect(onThreadItem).toBeTypeOf("function");

    const inProgressActivity = makeToolActivity({
      id: "activity-worker-progress",
      kind: "tool.updated",
      status: "inProgress",
      createdAt: "2026-04-13T00:00:01.000Z",
    });
    const staleThread = makeThreadDetail({ threadId, activities: [inProgressActivity] });
    onThreadItem({
      kind: "snapshot",
      snapshot: { snapshotSequence: 1, thread: staleThread },
    });
    onThreadItem({
      kind: "event",
      event: makeThreadEvent(
        "thread.activity-appended",
        {
          threadId,
          activity: makeToolActivity({
            id: "activity-worker-complete",
            kind: "tool.completed",
            status: "completed",
            createdAt: "2026-04-13T00:00:02.000Z",
          }),
        },
        2,
      ),
    });
    onThreadItem({
      kind: "snapshot",
      snapshot: { snapshotSequence: 1, thread: staleThread },
    });

    const thread = selectThreadByRef(useStore.getState(), scopeThreadRef(environmentId, threadId));
    const workEntries = deriveWorkLogEntries(thread?.activities ?? []);
    expect(workEntries).toHaveLength(1);
    expect(workEntries[0]?.toolLifecycleStatus).toBe("completed");
    expect(workEntries[0]?.sourceActivityKind).toBe("tool.completed");

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("retains orchestrator project and task subscriptions while referenced", async () => {
    const {
      retainOrchestratorProjectSubscription,
      retainOrchestratorTaskSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const projectId = ProjectId.make("project-1");
    const taskId = TaskId.make("task-1");

    const releaseProjectFirst = retainOrchestratorProjectSubscription(environmentId, projectId);
    const releaseProjectSecond = retainOrchestratorProjectSubscription(environmentId, projectId);
    const releaseTask = retainOrchestratorTaskSubscription(environmentId, taskId);

    expect(mockSubscribeProject).toHaveBeenCalledTimes(1);
    expect(mockSubscribeProject).toHaveBeenCalledWith({ projectId }, expect.any(Function));
    expect(mockSubscribeTask).toHaveBeenCalledTimes(1);
    expect(mockSubscribeTask).toHaveBeenCalledWith({ taskId }, expect.any(Function));

    releaseProjectFirst();
    expect(mockProjectUnsubscribe).not.toHaveBeenCalled();

    releaseProjectSecond();
    expect(mockProjectUnsubscribe).toHaveBeenCalledTimes(1);

    releaseTask();
    expect(mockTaskUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("does not start the primary connection until the known environment has an id", async () => {
    mockGetPrimaryKnownEnvironment.mockReturnValue({
      id: "env-1",
      label: "Primary environment",
      source: "window-origin",
      target: {
        httpBaseUrl: "http://127.0.0.1:3000/",
        wsBaseUrl: "ws://127.0.0.1:3000/",
      },
    });
    const {
      listEnvironmentConnections,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());

    expect(mockCreateEnvironmentConnection).not.toHaveBeenCalled();
    expect(listEnvironmentConnections()).toEqual([]);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("keeps non-idle thread detail subscriptions attached until the thread becomes idle", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-active");

    const connectionInput = mockCreateEnvironmentConnection.mock.calls[0]?.[0];
    expect(connectionInput).toBeDefined();

    connectionInput.syncShellSnapshot(
      makeThreadShellSnapshot({
        threadId,
        sessionStatus: "ready",
        hasPendingApprovals: true,
      }),
      environmentId,
    );

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    connectionInput.applyShellEvent(
      {
        kind: "thread-upserted",
        sequence: 2,
        thread: makeThreadShellSnapshot({
          threadId,
          sessionStatus: "idle",
        }).threads[0]!,
      },
      environmentId,
    );

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("reattaches retained thread detail subscriptions after a saved environment reconnect replaces the client", async () => {
    const environmentId = EnvironmentId.make("env-remote");
    const threadId = ThreadId.make("thread-reconnect");
    const record = {
      environmentId,
      label: "Remote env",
      httpBaseUrl: "http://remote.example.test",
      wsBaseUrl: "ws://remote.example.test",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
    };
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("bearer-token");

    const {
      disconnectSavedEnvironment,
      listEnvironmentConnections,
      reconnectSavedEnvironment,
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(mockCreateEnvironmentConnection).toHaveBeenCalledTimes(2);
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    await disconnectSavedEnvironment(environmentId);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);
    expect(
      listEnvironmentConnections().some((connection) => connection.environmentId === environmentId),
    ).toBe(false);

    const reconnectPromise = reconnectSavedEnvironment(environmentId);
    await vi.advanceTimersByTimeAsync(200);
    await reconnectPromise;
    await vi.waitFor(() => {
      expect(mockCreateEnvironmentConnection).toHaveBeenCalledTimes(3);
      expect(mockSubscribeThread).toHaveBeenCalledTimes(2);
    });

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("keeps healthy environment streams connected when the browser resumes from the background", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    vi.stubGlobal("document", {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
      get visibilityState() {
        return visibilityState;
      },
    });
    vi.stubGlobal("window", {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    });

    const { resetEnvironmentServiceForTests, startEnvironmentConnectionService } =
      await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    expect(mockConnectionReconnects).toHaveLength(1);

    visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).not.toHaveBeenCalled();

    visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("reconnects stale environment streams when the browser resumes from the background", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    vi.stubGlobal("document", {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
      get visibilityState() {
        return visibilityState;
      },
    });
    vi.stubGlobal("window", {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    });
    mockCreateWsRpcClient.mockReturnValue({
      server: {
        getConfig: vi.fn(async () => ({
          environment: {
            environmentId: EnvironmentId.make("env-remote"),
            label: "Remote env",
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          },
        })),
      },
      isHeartbeatFresh: vi.fn(() => false),
      orchestration: {
        subscribeThread: mockSubscribeThread,
      },
    });

    const { resetEnvironmentServiceForTests, startEnvironmentConnectionService } =
      await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    expect(mockConnectionReconnects).toHaveLength(1);

    visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).not.toHaveBeenCalled();

    visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("allows a larger idle cache before capacity eviction starts", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");

    for (let index = 0; index < 12; index += 1) {
      const release = retainThreadDetailSubscription(
        environmentId,
        ThreadId.make(`thread-${index + 1}`),
      );
      release();
    }

    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("disposes cached thread detail subscriptions when the environment service resets", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-2");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    release();

    await resetEnvironmentServiceForTests();
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
  });
});
