import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveWorkerStageRuntimeMode } from "./workerSafety.ts";
import { resolveOrchestratorPmRuntimePolicy } from "./orchestratorRuntimeModes.ts";

describe("worker runtime mode", () => {
  it("always starts orchestrator workers with full access", () => {
    expect(resolveWorkerStageRuntimeMode()).toBe("full-access");
  });
});

describe("PM runtime policy", () => {
  it("uses Codex workspace writes with native auto-review", () => {
    expect(resolveOrchestratorPmRuntimePolicy(ProviderDriverKind.make("codex"))).toEqual({
      runtimeMode: "auto-accept-edits",
      approvalReviewer: "auto-review",
    });
  });

  it.each(["claudeAgent", "opencode"] as const)(
    "keeps %s on provider-native full access",
    (provider) => {
      expect(resolveOrchestratorPmRuntimePolicy(ProviderDriverKind.make(provider))).toEqual({
        runtimeMode: "full-access",
      });
    },
  );
});
