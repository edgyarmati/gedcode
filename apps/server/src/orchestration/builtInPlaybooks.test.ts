import { describe, expect, it } from "vitest";

import { BUILT_IN_FEATURE_PLAYBOOK_TEXT } from "./builtInPlaybooks.ts";

describe("built-in feature playbook", () => {
  it("bounds oversized-task splitting behind the existing plan gate", () => {
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toContain("2-8 ordered child slices");
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toContain("explicit acceptance criteria");
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toContain("dependencies only on earlier slices");
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(
      /existing\s+plan gate approves that complete child structure/,
    );
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toContain("there is no separate split gate");
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toContain("one idempotent split operation");
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toContain("schedule only unblocked children");
  });
});
