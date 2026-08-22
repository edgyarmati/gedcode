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

  it("continues one bounded work correction while keeping verification independent", () => {
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(
      /continue that same\s+thread once with precise correction instructions/,
    );
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(
      /Start a fresh Work attempt only for a materially\s+different approach/,
    );
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(
      /then run a\s+fresh\s+independent Verify after the fix settles/,
    );
  });

  // #7780: verifiers must finish their whole check plan and report everything
  // at once instead of ending the turn at the first problem.
  it("requires verifiers to run their full check plan and enumerate all findings", () => {
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(
      /full planned check set up front and run every check before ending the turn/,
    );
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(/never stop\s+at the first problem/);
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(
      /one enumerated list with severity and\s+file references/,
    );
    expect(BUILT_IN_FEATURE_PLAYBOOK_TEXT).toMatch(
      /[Ss]end the findings to Work rather than letting Verify repair them/,
    );
  });
});
