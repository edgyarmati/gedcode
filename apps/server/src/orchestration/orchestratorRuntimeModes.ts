import type { ProviderApprovalReviewer, ProviderDriverKind, RuntimeMode } from "@t3tools/contracts";

export const ORCHESTRATOR_WORKER_RUNTIME_MODE: RuntimeMode = "full-access";

// Codex workers override this provider-neutral default at session admission:
// workspace-write plus Codex auto-review replaces danger-full-access. Claude
// and OpenCode workers continue to use this full-access default.

export type OrchestratorPmRuntimePolicy = {
  readonly runtimeMode: RuntimeMode;
  readonly approvalReviewer?: ProviderApprovalReviewer;
};

/**
 * Keep Codex inside the project workspace while letting its native auto-review
 * approve ordinary edits. Requests that auto-review cannot grant remain normal
 * provider approval requests and are projected to the PM conversation for the
 * user. Claude and OpenCode retain their provider-native full-access mode.
 */
export function resolveOrchestratorPmRuntimePolicy(
  driverKind: ProviderDriverKind,
): OrchestratorPmRuntimePolicy {
  if (driverKind === "codex") {
    return {
      runtimeMode: "auto-accept-edits",
      approvalReviewer: "auto-review",
    };
  }
  return { runtimeMode: "full-access" };
}
