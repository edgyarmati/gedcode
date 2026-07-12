import type {
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusStreamEvent,
} from "@t3tools/contracts";
import {
  GateId,
  ORCHESTRATOR_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  TaskId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("./wsTransport", () => ({
  WsTransport: class WsTransport {
    dispose = vi.fn(async () => undefined);
    reconnect = vi.fn(async () => undefined);
    request = vi.fn();
    requestStream = vi.fn();
    subscribe = vi.fn(() => () => undefined);
  },
}));

import { createWsRpcClient } from "./wsRpcClient";
import { type WsTransport } from "./wsTransport";

const baseLocalStatus: VcsStatusLocalResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/demo",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: VcsStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

describe("wsRpcClient", () => {
  it("reduces vcs status stream events into flat status snapshots", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      for (const event of [
        {
          _tag: "snapshot",
          local: baseLocalStatus,
          remote: null,
        },
        {
          _tag: "remoteUpdated",
          remote: baseRemoteStatus,
        },
        {
          _tag: "localUpdated",
          local: {
            ...baseLocalStatus,
            hasWorkingTreeChanges: true,
          },
        },
      ] satisfies VcsStatusStreamEvent[]) {
        listener(event as TValue);
      }
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn();

    client.vcs.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          aheadOfDefaultCount: 0,
          pr: null,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
          hasWorkingTreeChanges: true,
        },
      ],
    ]);
  });

  it("routes orchestrator methods through the transport with stable tags", async () => {
    const projectId = ProjectId.make("project-1");
    const taskId = TaskId.make("task-1");
    const gateId = GateId.make("gate-1");
    const protocolClient = {
      [ORCHESTRATOR_WS_METHODS.sendMessage]: vi.fn(() => ({ accepted: true })),
      [ORCHESTRATOR_WS_METHODS.subscribeProject]: vi.fn(() => "project-stream"),
      [ORCHESTRATOR_WS_METHODS.subscribeTask]: vi.fn(() => "task-stream"),
      [ORCHESTRATOR_WS_METHODS.resolveGate]: vi.fn(() => ({ sequence: 7 })),
      [ORCHESTRATOR_WS_METHODS.setTaskRoleSelections]: vi.fn(() => ({ sequence: 8 })),
      [ORCHESTRATOR_WS_METHODS.landTask]: vi.fn(() => ({
        sequence: 11,
        alreadyLanded: false,
      })),
      [ORCHESTRATOR_WS_METHODS.cancelTask]: vi.fn(() => ({ sequence: 10 })),
      [ORCHESTRATOR_WS_METHODS.listArchivedTasks]: vi.fn(() => []),
      [ORCHESTRATOR_WS_METHODS.archiveTask]: vi.fn(() => ({ sequence: 12 })),
      [ORCHESTRATOR_WS_METHODS.restoreTask]: vi.fn(() => ({ sequence: 13 })),
      [ORCHESTRATOR_WS_METHODS.deleteTask]: vi.fn(() => ({ sequence: 14 })),
      [ORCHESTRATOR_WS_METHODS.clearPmChat]: vi.fn(() => ({ sequence: 9 })),
      [ORCHESTRATOR_WS_METHODS.requestPmHandoff]: vi.fn(() => ({
        accepted: true,
        mode: "transcript" as const,
      })),
    };
    const request = vi.fn((execute: (client: typeof protocolClient) => unknown) =>
      Promise.resolve(execute(protocolClient)),
    );
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (
        connect: (client: typeof protocolClient) => unknown,
        _listener: unknown,
        _options?: unknown,
      ) => {
        connect(protocolClient);
        return unsubscribe;
      },
    );
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request,
      requestStream: vi.fn(),
      subscribe,
      isHeartbeatFresh: vi.fn(() => true),
    };
    const client = createWsRpcClient(transport as unknown as WsTransport);
    const projectListener = vi.fn();
    const taskListener = vi.fn();
    const onResubscribe = vi.fn();

    await expect(
      client.orchestrator.sendMessage({ projectId, message: "Build it" }),
    ).resolves.toEqual({ accepted: true });
    expect(
      client.orchestrator.subscribeProject({ projectId }, projectListener, { onResubscribe }),
    ).toBe(unsubscribe);
    expect(client.orchestrator.subscribeTask({ taskId }, taskListener)).toBe(unsubscribe);
    await expect(
      client.orchestrator.resolveGate({
        taskId,
        gateId,
        gate: "plan",
        approvedHash: "hash-1",
        decision: "approved",
      }),
    ).resolves.toEqual({ sequence: 7 });
    await expect(
      client.orchestrator.setTaskRoleSelections({
        taskId,
        roleModelSelections: {
          work: {
            instanceId: ProviderInstanceId.make("codex_task"),
            model: "gpt-5-task",
          },
        },
      }),
    ).resolves.toEqual({ sequence: 8 });
    await expect(client.orchestrator.cancelTask({ taskId })).resolves.toEqual({ sequence: 10 });
    await expect(client.orchestrator.landTask({ taskId })).resolves.toEqual({
      sequence: 11,
      alreadyLanded: false,
    });
    await expect(client.orchestrator.listArchivedTasks({ projectId })).resolves.toEqual([]);
    await expect(client.orchestrator.archiveTask({ taskId })).resolves.toEqual({ sequence: 12 });
    await expect(client.orchestrator.restoreTask({ taskId })).resolves.toEqual({ sequence: 13 });
    await expect(client.orchestrator.deleteTask({ taskId })).resolves.toEqual({ sequence: 14 });
    await expect(client.orchestrator.clearPmChat({ projectId })).resolves.toEqual({ sequence: 9 });
    await expect(
      client.orchestrator.requestPmHandoff({ projectId, mode: "transcript" }),
    ).resolves.toEqual({ accepted: true, mode: "transcript" });

    expect(protocolClient[ORCHESTRATOR_WS_METHODS.sendMessage]).toHaveBeenCalledWith({
      projectId,
      message: "Build it",
    });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.subscribeProject]).toHaveBeenCalledWith({
      projectId,
    });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.subscribeTask]).toHaveBeenCalledWith({ taskId });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.resolveGate]).toHaveBeenCalledWith({
      taskId,
      gateId,
      gate: "plan",
      approvedHash: "hash-1",
      decision: "approved",
    });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.setTaskRoleSelections]).toHaveBeenCalledWith({
      taskId,
      roleModelSelections: {
        work: {
          instanceId: ProviderInstanceId.make("codex_task"),
          model: "gpt-5-task",
        },
      },
    });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.cancelTask]).toHaveBeenCalledWith({ taskId });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.landTask]).toHaveBeenCalledWith({ taskId });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.listArchivedTasks]).toHaveBeenCalledWith({
      projectId,
    });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.archiveTask]).toHaveBeenCalledWith({ taskId });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.restoreTask]).toHaveBeenCalledWith({ taskId });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.deleteTask]).toHaveBeenCalledWith({ taskId });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.clearPmChat]).toHaveBeenCalledWith({
      projectId,
    });
    expect(protocolClient[ORCHESTRATOR_WS_METHODS.requestPmHandoff]).toHaveBeenCalledWith({
      projectId,
      mode: "transcript",
    });
    expect(subscribe.mock.calls[0]?.[2]).toEqual({
      onResubscribe,
      tag: ORCHESTRATOR_WS_METHODS.subscribeProject,
    });
    expect(subscribe.mock.calls[1]?.[2]).toEqual({
      tag: ORCHESTRATOR_WS_METHODS.subscribeTask,
    });
  });
});
