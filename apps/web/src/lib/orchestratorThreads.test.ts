import { describe, expect, it } from "vitest";

import {
  isOrchestratorManagedThread,
  isOrchestratorStageBranch,
  isPmThreadId,
} from "./orchestratorThreads";

describe("orchestrator thread detection", () => {
  it("flags PM chat threads by their `pm:` id prefix", () => {
    expect(isPmThreadId("pm:project-1")).toBe(true);
    expect(isPmThreadId("thread-123")).toBe(false);
  });

  it("flags worker stage threads by their `orchestrator/` branch", () => {
    expect(isOrchestratorStageBranch("orchestrator/9f3b-uuid")).toBe(true);
    expect(isOrchestratorStageBranch("feature/login")).toBe(false);
    expect(isOrchestratorStageBranch(null)).toBe(false);
  });

  it("excludes both PM and stage threads from the chat list, keeps normal threads", () => {
    // Stage thread: normal-looking id but on an orchestrator branch.
    expect(isOrchestratorManagedThread({ id: "thread-abc", branch: "orchestrator/task-1" })).toBe(
      true,
    );
    // PM thread: pm: id, no branch.
    expect(isOrchestratorManagedThread({ id: "pm:project-1", branch: null })).toBe(true);
    // Normal chat thread on a normal branch (or no branch) stays.
    expect(isOrchestratorManagedThread({ id: "thread-abc", branch: "main" })).toBe(false);
    expect(isOrchestratorManagedThread({ id: "thread-abc", branch: null })).toBe(false);
  });
});
