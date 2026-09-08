import { describe, expect, it } from "vitest";

import { collectOrderedRecordValues } from "./storeCollection";

describe("collectOrderedRecordValues", () => {
  it("returns the same collection while both normalized slices are unchanged", () => {
    const ids = ["a", "b"];
    const byId = { a: { value: 1 }, b: { value: 2 } };

    const first = collectOrderedRecordValues(ids, byId);
    const second = collectOrderedRecordValues(ids, byId);

    expect(second).toBe(first);
    expect(second).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it("invalidates when either the ordered ids or value record changes", () => {
    const ids = ["a", "b"];
    const byId = { a: { value: 1 }, b: { value: 2 } };
    const first = collectOrderedRecordValues(ids, byId);

    expect(collectOrderedRecordValues(["a", "b"], byId)).not.toBe(first);
    expect(collectOrderedRecordValues(ids, { ...byId })).not.toBe(first);
  });

  it("omits missing entries without destabilizing the cached result", () => {
    const ids = ["present", "missing"];
    const byId = { present: "kept" } as Record<string, string>;

    const first = collectOrderedRecordValues(ids, byId);

    expect(first).toEqual(["kept"]);
    expect(collectOrderedRecordValues(ids, byId)).toBe(first);
  });
});
