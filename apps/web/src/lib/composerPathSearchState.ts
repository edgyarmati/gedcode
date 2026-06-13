import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";

import { projectSearchEntriesQueryOptions } from "./projectReactQuery";

const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
const COMPOSER_PATH_SEARCH_LIMIT = 80;
const EMPTY_PROJECT_ENTRIES: ReadonlyArray<ProjectEntry> = [];

export interface ComposerPathSearchInput {
  readonly environmentId: EnvironmentId;
  /** Working directory to resolve relative paths against, or null when inactive. */
  readonly cwd: string | null;
  /** The active path query (without the leading `@`), or null when not in a path trigger. */
  readonly query: string | null;
}

export interface ComposerPathSearchResult {
  readonly entries: ReadonlyArray<ProjectEntry>;
  readonly isPending: boolean;
}

/**
 * Debounced workspace path search for composer `@path` autocomplete.
 *
 * Wraps the existing project search-entries query, debouncing the query and
 * exposing a single `isPending` flag that combines debounce + fetch latency.
 * The search stays disabled until a path trigger is active (`query !== null`).
 */
export function useComposerPathSearch({
  environmentId,
  cwd,
  query,
}: ComposerPathSearchInput): ComposerPathSearchResult {
  const isActive = query !== null;
  const rawQuery = query ?? "";
  const [debouncedQuery, queryDebouncer] = useDebouncedValue(
    rawQuery,
    { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const effectiveQuery = rawQuery.length > 0 ? debouncedQuery : "";
  const entriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId,
      cwd,
      query: effectiveQuery,
      enabled: isActive,
      limit: COMPOSER_PATH_SEARCH_LIMIT,
    }),
  );
  const entries = entriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const isPending =
    queryDebouncer.state.isPending || entriesQuery.isLoading || entriesQuery.isFetching;
  return { entries, isPending };
}
