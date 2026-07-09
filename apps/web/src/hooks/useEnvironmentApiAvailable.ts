import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useSyncExternalStore } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { subscribeEnvironmentConnections } from "../environments/runtime";

export function useEnvironmentApiAvailable(environmentId: EnvironmentId): boolean {
  const getSnapshot = useCallback(
    () => readEnvironmentApi(environmentId) !== undefined,
    [environmentId],
  );

  return useSyncExternalStore(subscribeEnvironmentConnections, getSnapshot, () => false);
}
