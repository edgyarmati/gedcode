import type { EnvironmentId, EnvironmentApi } from "@t3tools/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection } from "./environments/runtime";

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return {
    server: {
      getConfig: rpcClient.server.getConfig,
    },
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
    },
    filesystem: {
      browse: rpcClient.filesystem.browse,
    },
    sourceControl: {
      lookupRepository: rpcClient.sourceControl.lookupRepository,
      cloneRepository: rpcClient.sourceControl.cloneRepository,
      publishRepository: rpcClient.sourceControl.publishRepository,
    },
    vcs: {
      pull: rpcClient.vcs.pull,
      refreshStatus: rpcClient.vcs.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.vcs.onStatus(input, callback, options),
      listRefs: rpcClient.vcs.listRefs,
      createWorktree: rpcClient.vcs.createWorktree,
      removeWorktree: rpcClient.vcs.removeWorktree,
      createRef: rpcClient.vcs.createRef,
      switchRef: rpcClient.vcs.switchRef,
      init: rpcClient.vcs.init,
    },
    git: {
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
    },
    orchestration: {
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      forkThread: rpcClient.orchestration.forkThread,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      getArchivedShellSnapshot: rpcClient.orchestration.getArchivedShellSnapshot,
      subscribeShell: (callback, options) =>
        rpcClient.orchestration.subscribeShell(callback, options),
      subscribeThread: (input, callback, options) =>
        rpcClient.orchestration.subscribeThread(input, callback, options),
    },
    orchestrator: {
      getPresetMigration: rpcClient.orchestrator.getPresetMigration,
      completePresetMigration: rpcClient.orchestrator.completePresetMigration,
      sendMessage: rpcClient.orchestrator.sendMessage,
      subscribeProject: (input, callback, options) =>
        rpcClient.orchestrator.subscribeProject(input, callback, options),
      subscribeTask: (input, callback, options) =>
        rpcClient.orchestrator.subscribeTask(input, callback, options),
      resolveGate: rpcClient.orchestrator.resolveGate,
      setTaskCapabilityTiers: rpcClient.orchestrator.setTaskCapabilityTiers,
      landTask: rpcClient.orchestrator.landTask,
      cancelTask: rpcClient.orchestrator.cancelTask,
      interruptStage: rpcClient.orchestrator.interruptStage,
      inspectTaskChanges: rpcClient.orchestrator.inspectTaskChanges,
      commitTaskChanges: rpcClient.orchestrator.commitTaskChanges,
      discardTaskChanges: rpcClient.orchestrator.discardTaskChanges,
      returnTaskChanges: rpcClient.orchestrator.returnTaskChanges,
      completeTaskWithoutChanges: rpcClient.orchestrator.completeTaskWithoutChanges,
      listArchivedTasks: rpcClient.orchestrator.listArchivedTasks,
      archiveTask: rpcClient.orchestrator.archiveTask,
      restoreTask: rpcClient.orchestrator.restoreTask,
      deleteTask: rpcClient.orchestrator.deleteTask,
      clearPmChat: rpcClient.orchestrator.clearPmChat,
      requestPmHandoff: rpcClient.orchestrator.requestPmHandoff,
      getProjectContextOnboarding: rpcClient.orchestrator.getProjectContextOnboarding,
      dismissProjectContextOnboarding: rpcClient.orchestrator.dismissProjectContextOnboarding,
      requestProjectContextRun: rpcClient.orchestrator.requestProjectContextRun,
      resolveProjectContextRunStart: rpcClient.orchestrator.resolveProjectContextRunStart,
      cancelProjectContextRunStart: rpcClient.orchestrator.cancelProjectContextRunStart,
      getProjectContextRunReview: rpcClient.orchestrator.getProjectContextRunReview,
      reviseProjectContextRun: rpcClient.orchestrator.reviseProjectContextRun,
      commitProjectContextRun: rpcClient.orchestrator.commitProjectContextRun,
      discardProjectContextRun: rpcClient.orchestrator.discardProjectContextRun,
      getLaunchCapabilities: rpcClient.orchestrator.getLaunchCapabilities,
      launch: rpcClient.orchestrator.launch,
    },
  };
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const overriddenApi = environmentApiOverridesForTests.get(environmentId);
  if (overriddenApi) {
    return overriddenApi;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}
