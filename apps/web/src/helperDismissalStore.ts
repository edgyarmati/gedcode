/**
 * Client-local dismissal state for pinned PM helper cards.
 *
 * Dismissal is deliberately not server state: it records that *this* browser has
 * finished reading a settled helper result, so it must survive reloads and
 * reconnects without synchronizing to other devices. Helper runs themselves stay
 * authoritative in the orchestration store and remain visible in Helper history.
 */

import { scopedProjectKey } from "@t3tools/client-runtime";
import type { HelperRunId, ScopedProjectRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export const HELPER_DISMISSAL_STORAGE_KEY = "t3code:helper-dismissals:v1";
export const HELPER_DISMISSAL_STORAGE_VERSION = 1;

export interface HelperDismissalRef extends ScopedProjectRef {
  readonly helperRunId: HelperRunId;
}

interface HelperDismissalStoreState {
  // Stamped rather than boolean so a future retention sweep can prune old keys
  // without another storage migration.
  dismissedAtByHelperKey: Record<string, number>;
}

const EMPTY_DISMISSED_IDS: ReadonlySet<string> = new Set();

// NUL-separated, matching the other composite client keys: no id can contain it,
// so one project's dismissals can never be read as a prefix-sharing project's.
const HELPER_KEY_SEPARATOR = "\u0000";

export function helperDismissalKey(ref: HelperDismissalRef): string {
  const projectKey = scopedProjectKey({
    environmentId: ref.environmentId,
    projectId: ref.projectId,
  });
  return `${projectKey}${HELPER_KEY_SEPARATOR}${String(ref.helperRunId)}`;
}

export function migratePersistedHelperDismissalState(
  persistedState: unknown,
  _version: number,
): HelperDismissalStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return { dismissedAtByHelperKey: {} };
  }
  const candidate = (persistedState as { dismissedAtByHelperKey?: unknown }).dismissedAtByHelperKey;
  if (!candidate || typeof candidate !== "object") {
    return { dismissedAtByHelperKey: {} };
  }
  return {
    dismissedAtByHelperKey: Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    ),
  };
}

export const useHelperDismissalStore = create<HelperDismissalStoreState>()(
  persist(() => ({ dismissedAtByHelperKey: {} }), {
    name: HELPER_DISMISSAL_STORAGE_KEY,
    version: HELPER_DISMISSAL_STORAGE_VERSION,
    storage: createJSONStorage(() =>
      resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
    ),
    migrate: migratePersistedHelperDismissalState,
    // `migrate` only runs when the stored version differs, so a same-version blob
    // written by a corrupt client would land in state as-is. Hydration normalizes
    // through the same narrowing either way.
    merge: (persistedState, currentState) => ({
      ...currentState,
      ...migratePersistedHelperDismissalState(persistedState, HELPER_DISMISSAL_STORAGE_VERSION),
    }),
  }),
);

export function dismissPmHelper(ref: HelperDismissalRef, dismissedAt: number = Date.now()): void {
  const key = helperDismissalKey(ref);
  useHelperDismissalStore.setState((state) =>
    state.dismissedAtByHelperKey[key] === undefined
      ? { dismissedAtByHelperKey: { ...state.dismissedAtByHelperKey, [key]: dismissedAt } }
      : state,
  );
}

export function selectDismissedPmHelperIds(
  state: HelperDismissalStoreState,
  ref: ScopedProjectRef | null | undefined,
): ReadonlySet<string> {
  if (!ref) return EMPTY_DISMISSED_IDS;
  const prefix = `${scopedProjectKey(ref)}${HELPER_KEY_SEPARATOR}`;
  const dismissed = new Set<string>();
  for (const key of Object.keys(state.dismissedAtByHelperKey)) {
    if (key.startsWith(prefix)) dismissed.add(key.slice(prefix.length));
  }
  return dismissed;
}
