const EMPTY_VALUES: never[] = [];
const collectedByIdsCache = new WeakMap<readonly string[], WeakMap<object, readonly unknown[]>>();

/**
 * Rebuild an ordered normalized slice only when its ids or backing record change.
 * Store reducers preserve both references for unrelated updates, so high-level
 * selectors avoid repeatedly walking every project/thread on streaming events.
 */
export function collectOrderedRecordValues<TKey extends string, TValue>(
  ids: readonly TKey[] | undefined,
  byId: Readonly<Partial<Record<TKey, TValue>>> | undefined,
  emptyValue: TValue[] = EMPTY_VALUES,
): TValue[] {
  if (!ids || ids.length === 0 || !byId) {
    return emptyValue;
  }

  const cachedByRecord = collectedByIdsCache.get(ids);
  const cached = cachedByRecord?.get(byId);
  if (cached) {
    return cached as TValue[];
  }

  const values = ids.flatMap((id) => {
    const value = byId[id];
    return value === undefined ? [] : [value];
  });
  const nextCachedByRecord = cachedByRecord ?? new WeakMap<object, readonly unknown[]>();
  nextCachedByRecord.set(byId, values);
  if (!cachedByRecord) {
    collectedByIdsCache.set(ids, nextCachedByRecord);
  }
  return values;
}
