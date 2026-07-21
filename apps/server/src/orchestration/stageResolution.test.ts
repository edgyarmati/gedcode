import { describe, expect, it } from "vitest";

import { prepareStageInstructions, stripStagePromptPrefix } from "./stageResolution.ts";

const PREFIX_MARKER = /BEGIN GEDCODE STAGE PROMPT PREFIX/g;
const countPrefixBlocks = (text: string): number => text.match(PREFIX_MARKER)?.length ?? 0;

const rawInstructions = "Implement the accepted plan.";
const rolePromptPrefixes = { work: "Use the project implementation playbook." } as const;

describe("prepareStageInstructions prompt-prefix", () => {
  it("prepends exactly one role-labelled prefix block to raw instructions", () => {
    const prepared = prepareStageInstructions({
      instructions: rawInstructions,
      role: "work",
      rolePromptPrefixes,
    });

    expect(countPrefixBlocks(prepared)).toBe(1);
    expect(prepared).toContain("Role: work");
    expect(prepared).toContain(rolePromptPrefixes.work);
    expect(prepared).toContain(rawInstructions);
  });

  it("always adds the built-in ownership boundary when the role has no configured prefix", () => {
    const prepared = prepareStageInstructions({
      instructions: rawInstructions,
      role: "verify",
      rolePromptPrefixes,
    });

    expect(countPrefixBlocks(prepared)).toBe(1);
    expect(prepared).toContain("documentation and verification evidence only");
    expect(prepared).toContain("Do not modify substantive implementation code");
    expect(prepared).toContain("sandboxed auto-approve environment");
    expect(prepared).toContain(rawInstructions);
  });

  it.each([
    ["plan", "Do not implement substantive product code"],
    ["work", "You own the substantive implementation"],
    ["verify", "Do not modify substantive implementation code"],
  ] as const)("adds the %s ownership contract", (role, expected) => {
    const prepared = prepareStageInstructions({
      instructions: rawInstructions,
      role,
      rolePromptPrefixes: undefined,
    });

    expect(prepared).toContain(expected);
  });

  it("is idempotent — re-preparing an already-prefixed string keeps a single prefix block", () => {
    const prepared = prepareStageInstructions({
      instructions: rawInstructions,
      role: "work",
      rolePromptPrefixes,
    });

    const reprepared = prepareStageInstructions({
      instructions: prepared,
      role: "work",
      rolePromptPrefixes,
    });

    expect(countPrefixBlocks(reprepared)).toBe(1);
    expect(reprepared).toBe(prepared);
  });

  // Guards the exactly-once invariant across the quota-resume path: resumption
  // recovers the original (stripped) instructions from the stage thread and
  // re-dispatches `task.stage.start`, which re-runs `prepareStageInstructions`.
  // A double-prefixed worker prompt here is the regression this test catches.
  it("does not double-prefix a quota-resumed stage that reuses original instructions", () => {
    const firstDispatch = prepareStageInstructions({
      instructions: rawInstructions,
      role: "work",
      rolePromptPrefixes,
    });

    // What `originalStageInstructions` recovers from the persisted thread message.
    const recovered = stripStagePromptPrefix(firstDispatch);
    expect(recovered).toBe(rawInstructions);

    const resumeDispatch = prepareStageInstructions({
      instructions: recovered,
      role: "work",
      rolePromptPrefixes,
    });

    expect(countPrefixBlocks(resumeDispatch)).toBe(1);
    expect(resumeDispatch).toBe(firstDispatch);
  });

  it("strips a leading prefix block and leaves unprefixed instructions untouched", () => {
    expect(stripStagePromptPrefix(rawInstructions)).toBe(rawInstructions);

    const prepared = prepareStageInstructions({
      instructions: rawInstructions,
      role: "work",
      rolePromptPrefixes,
    });
    expect(stripStagePromptPrefix(prepared)).toBe(rawInstructions);
  });
});
