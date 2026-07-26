import { EnvironmentId, HelperRunId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  HELPER_DISMISSAL_STORAGE_KEY,
  dismissPmHelper,
  helperDismissalKey,
  migratePersistedHelperDismissalState,
  selectDismissedPmHelperIds,
  useHelperDismissalStore,
} from "./helperDismissalStore";

const environmentId = EnvironmentId.make("env-local");
const otherEnvironmentId = EnvironmentId.make("env-remote");
const projectId = ProjectId.make("project-a");
const otherProjectId = ProjectId.make("project-b");
const helperRunId = HelperRunId.make("helper-1");

describe("helperDismissalStore", () => {
  beforeEach(() => {
    useHelperDismissalStore.persist.clearStorage();
    useHelperDismissalStore.setState({ dismissedAtByHelperKey: {} });
  });

  // The point of persisting dismissal is that a helper the user finished reading
  // does not come back when the page reloads.
  it("restores dismissals recorded before a reload", async () => {
    const storage = useHelperDismissalStore.persist.getOptions().storage;
    dismissPmHelper({ environmentId, projectId, helperRunId });
    const persistedByPreviousLoad = await storage?.getItem(HELPER_DISMISSAL_STORAGE_KEY);

    // A fresh page load starts with empty in-memory state and rehydrates from
    // whatever the previous load left in storage.
    useHelperDismissalStore.setState({ dismissedAtByHelperKey: {} });
    if (persistedByPreviousLoad) {
      await storage?.setItem(HELPER_DISMISSAL_STORAGE_KEY, persistedByPreviousLoad);
    }
    await useHelperDismissalStore.persist.rehydrate();

    expect(
      selectDismissedPmHelperIds(useHelperDismissalStore.getState(), {
        environmentId,
        projectId,
      }),
    ).toEqual(new Set(["helper-1"]));
  });

  // Dismissal is client-local UI state, so it has to be keyed tightly enough
  // that the same helper id in another environment or project is unaffected.
  it("scopes dismissal by environment, project, and helper id", () => {
    dismissPmHelper({ environmentId, projectId, helperRunId });

    expect(
      selectDismissedPmHelperIds(useHelperDismissalStore.getState(), {
        environmentId,
        projectId,
      }),
    ).toEqual(new Set(["helper-1"]));
    expect(
      selectDismissedPmHelperIds(useHelperDismissalStore.getState(), {
        environmentId: otherEnvironmentId,
        projectId,
      }),
    ).toEqual(new Set());
    expect(
      selectDismissedPmHelperIds(useHelperDismissalStore.getState(), {
        environmentId,
        projectId: otherProjectId,
      }),
    ).toEqual(new Set());
  });

  // `migrate` only runs when the persisted version differs, so a same-version
  // blob written by a corrupt client reaches state unnormalized unless hydration
  // normalizes it too.
  it("normalizes a corrupt same-version persisted blob on hydration", async () => {
    const storage = useHelperDismissalStore.persist.getOptions().storage;
    await storage?.setItem(HELPER_DISMISSAL_STORAGE_KEY, {
      state: { dismissedAtByHelperKey: null },
      version: 1,
    } as unknown as Parameters<NonNullable<typeof storage>["setItem"]>[1]);

    await useHelperDismissalStore.persist.rehydrate();

    expect(useHelperDismissalStore.getState().dismissedAtByHelperKey).toEqual({});
    expect(
      selectDismissedPmHelperIds(useHelperDismissalStore.getState(), {
        environmentId,
        projectId,
      }),
    ).toEqual(new Set());
  });

  it("keeps distinct keys per scope", () => {
    expect(helperDismissalKey({ environmentId, projectId, helperRunId })).not.toBe(
      helperDismissalKey({ environmentId: otherEnvironmentId, projectId, helperRunId }),
    );
  });

  it("persists dismissals under a versioned storage key", () => {
    expect(HELPER_DISMISSAL_STORAGE_KEY).toBe("t3code:helper-dismissals:v1");
  });

  // A dismissal written by an older or corrupt client must not resurrect cards
  // or crash hydration.
  it("drops unrecognized persisted shapes on hydration", () => {
    expect(migratePersistedHelperDismissalState({ dismissedAtByHelperKey: 7 }, 1)).toEqual({
      dismissedAtByHelperKey: {},
    });
    expect(
      migratePersistedHelperDismissalState(
        { dismissedAtByHelperKey: { "env-local\u0000project-a\u0000helper-1": 5 } },
        1,
      ),
    ).toEqual({ dismissedAtByHelperKey: { "env-local\u0000project-a\u0000helper-1": 5 } });
  });
});
