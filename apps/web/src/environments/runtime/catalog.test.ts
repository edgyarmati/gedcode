import {
  EnvironmentId,
  type LocalApi,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasSavedEnvironmentRegistryHydrated,
  persistSavedEnvironmentRecord,
  persistSavedEnvironmentRegistry,
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  waitForSavedEnvironmentRegistryHydration,
} from "./catalog";

function makeControlledRegistryPersistence() {
  let resolveFirstWrite!: () => void;
  let notifyFirstWriteStarted!: () => void;
  const firstWriteStarted = new Promise<void>((resolve) => {
    notifyFirstWriteStarted = resolve;
  });
  const setSavedEnvironmentRegistry = vi.fn(
    (_records: readonly PersistedSavedEnvironmentRecord[]) => {
      if (setSavedEnvironmentRegistry.mock.calls.length === 1) {
        notifyFirstWriteStarted();
        return new Promise<void>((resolve) => {
          resolveFirstWrite = resolve;
        });
      }
      return Promise.resolve();
    },
  );

  return {
    firstWriteStarted,
    releaseFirstWrite: () => resolveFirstWrite(),
    setSavedEnvironmentRegistry,
  };
}

async function installRegistryPersistence(
  setSavedEnvironmentRegistry: LocalApi["persistence"]["setSavedEnvironmentRegistry"],
) {
  vi.stubGlobal("window", {
    nativeApi: {
      persistence: {
        getClientSettings: async () => null,
        setClientSettings: async () => undefined,
        getSavedEnvironmentRegistry: async () => [],
        setSavedEnvironmentRegistry,
        getSavedEnvironmentSecret: async () => null,
        setSavedEnvironmentSecret: async () => true,
        removeSavedEnvironmentSecret: async () => undefined,
      },
    } satisfies Pick<LocalApi, "persistence">,
  });
  const { __resetLocalApiForTests } = await import("../../localApi");
  await __resetLocalApiForTests();
}

describe("environment runtime catalog stores", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    resetSavedEnvironmentRegistryStoreForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  it("resets the saved environment registry store state", () => {
    const environmentId = EnvironmentId.make("environment-1");

    useSavedEnvironmentRegistryStore.getState().upsert({
      environmentId,
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    });

    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toBeDefined();

    resetSavedEnvironmentRegistryStoreForTests();

    expect(useSavedEnvironmentRegistryStore.getState().byId).toEqual({});
  });

  it("resets the saved environment runtime store state", () => {
    const environmentId = EnvironmentId.make("environment-1");

    useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
      connectionState: "connected",
      connectedAt: "2026-04-09T00:00:00.000Z",
    });

    expect(useSavedEnvironmentRuntimeStore.getState().byId[environmentId]).toBeDefined();

    resetSavedEnvironmentRuntimeStoreForTests();

    expect(useSavedEnvironmentRuntimeStore.getState().byId).toEqual({});
  });

  it("does not throw when local api lookup fails during registry persistence", async () => {
    vi.unstubAllGlobals();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    expect(() =>
      useSavedEnvironmentRegistryStore.getState().upsert({
        environmentId: EnvironmentId.make("environment-1"),
        label: "Remote environment",
        httpBaseUrl: "https://remote.example.com/",
        wsBaseUrl: "wss://remote.example.com/",
        createdAt: "2026-04-09T00:00:00.000Z",
        lastConnectedAt: null,
      }),
    ).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith("[SAVED_ENVIRONMENTS] persist failed", expect.any(Error));
  });

  it("persists registry snapshots in mutation order", async () => {
    const controlledPersistence = makeControlledRegistryPersistence();
    const { setSavedEnvironmentRegistry } = controlledPersistence;
    await installRegistryPersistence(setSavedEnvironmentRegistry);

    const environmentId = EnvironmentId.make("environment-1");
    useSavedEnvironmentRegistryStore.getState().upsert({
      environmentId,
      label: "Original label",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    });
    await controlledPersistence.firstWriteStarted;

    useSavedEnvironmentRegistryStore.getState().rename(environmentId, "Renamed");
    await Promise.resolve();

    expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1);
    expect(setSavedEnvironmentRegistry.mock.calls[0]?.[0]?.[0]?.label).toBe("Original label");

    controlledPersistence.releaseFirstWrite();
    await vi.waitFor(() => {
      expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(2);
    });
    expect(setSavedEnvironmentRegistry.mock.calls[1]?.[0]?.[0]?.label).toBe("Renamed");
  });

  it("serializes awaited registry persistence with store mutations", async () => {
    const controlledPersistence = makeControlledRegistryPersistence();
    const { setSavedEnvironmentRegistry } = controlledPersistence;
    await installRegistryPersistence(setSavedEnvironmentRegistry);

    const environmentId = EnvironmentId.make("environment-1");
    const record = {
      environmentId,
      label: "Original label",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    useSavedEnvironmentRegistryStore.getState().upsert(record);
    await controlledPersistence.firstWriteStarted;

    const awaitedPersistence = persistSavedEnvironmentRecord({
      ...record,
      label: "Awaited update",
    });
    const fullRegistryPersistence = persistSavedEnvironmentRegistry([
      {
        ...record,
        label: "Full registry update",
      },
    ]);
    await Promise.resolve();

    expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(1);

    controlledPersistence.releaseFirstWrite();
    await Promise.all([awaitedPersistence, fullRegistryPersistence]);

    expect(setSavedEnvironmentRegistry).toHaveBeenCalledTimes(3);
    expect(setSavedEnvironmentRegistry.mock.calls[1]?.[0]?.[0]?.label).toBe("Awaited update");
    expect(setSavedEnvironmentRegistry.mock.calls[2]?.[0]?.[0]?.label).toBe("Full registry update");
  });

  it("does not let stale hydration overwrite records added while hydration is in flight", async () => {
    let resolveRegistryRead: () => void = () => {
      throw new Error("Registry read resolver was not initialized.");
    };

    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: () =>
            new Promise<readonly PersistedSavedEnvironmentRecord[]>((resolve) => {
              resolveRegistryRead = () => resolve([]);
            }),
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });

    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    const hydrationPromise = waitForSavedEnvironmentRegistryHydration();

    const environmentId = EnvironmentId.make("environment-1");
    const record = {
      environmentId,
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;

    useSavedEnvironmentRegistryStore.getState().upsert(record);

    resolveRegistryRead();
    await hydrationPromise;

    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toEqual(record);
  });

  it("keeps failed registry hydration retryable", async () => {
    const environmentId = EnvironmentId.make("environment-1");
    const persistedRecord = {
      environmentId,
      label: "Remote environment",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      createdAt: "2026-04-09T00:00:00.000Z",
      lastConnectedAt: null,
    } as const;
    const getSavedEnvironmentRegistry = vi
      .fn<() => Promise<readonly PersistedSavedEnvironmentRecord[]>>()
      .mockRejectedValueOnce(new Error("registry read failed"))
      .mockResolvedValueOnce([persistedRecord]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry,
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    await expect(waitForSavedEnvironmentRegistryHydration()).rejects.toThrow(
      "registry read failed",
    );
    expect(hasSavedEnvironmentRegistryHydrated()).toBe(false);

    await waitForSavedEnvironmentRegistryHydration();

    expect(getSavedEnvironmentRegistry).toHaveBeenCalledTimes(2);
    expect(hasSavedEnvironmentRegistryHydrated()).toBe(true);
    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toEqual(
      persistedRecord,
    );
    expect(errorSpy).toHaveBeenCalledWith("[SAVED_ENVIRONMENTS] hydrate failed", expect.any(Error));
  });
});
