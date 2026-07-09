import { EnvironmentId, type EnvironmentApi } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStore = vi.hoisted(() => ({
  apiByEnvironment: new Map<string, EnvironmentApi>(),
  currentSnapshot: undefined as boolean | undefined,
  listeners: new Set<() => void>(),
  storeListener: null as (() => void) | null,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <Callback extends (...args: Array<never>) => unknown>(callback: Callback) =>
      callback,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => boolean,
    ) => {
      if (!mockStore.storeListener) {
        mockStore.storeListener = () => {
          mockStore.currentSnapshot = getSnapshot();
        };
        subscribe(mockStore.storeListener);
      }
      mockStore.currentSnapshot = getSnapshot();
      return mockStore.currentSnapshot;
    },
  };
});

vi.mock("../environmentApi", () => ({
  readEnvironmentApi: (environmentId: EnvironmentId) =>
    mockStore.apiByEnvironment.get(environmentId),
}));

vi.mock("../environments/runtime", () => ({
  subscribeEnvironmentConnections: (listener: () => void) => {
    mockStore.listeners.add(listener);
    return () => {
      mockStore.listeners.delete(listener);
    };
  },
}));

import { useEnvironmentApiAvailable } from "./useEnvironmentApiAvailable";

describe("useEnvironmentApiAvailable", () => {
  beforeEach(() => {
    mockStore.apiByEnvironment.clear();
    mockStore.currentSnapshot = undefined;
    mockStore.listeners.clear();
    mockStore.storeListener = null;
  });

  it("updates availability when the environment connection registry emits after mount", () => {
    const environmentId = EnvironmentId.make("environment-delayed");

    expect(useEnvironmentApiAvailable(environmentId)).toBe(false);
    expect(mockStore.currentSnapshot).toBe(false);
    expect(mockStore.listeners.size).toBe(1);

    mockStore.apiByEnvironment.set(environmentId, {} as EnvironmentApi);
    for (const listener of mockStore.listeners) {
      listener();
    }

    expect(mockStore.currentSnapshot).toBe(true);
  });
});
