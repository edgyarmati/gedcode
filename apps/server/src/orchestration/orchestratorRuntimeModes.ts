import type { ProviderApprovalReviewer, ProviderDriverKind, RuntimeMode } from "@t3tools/contracts";

// Provider-neutral worker policy: every orchestration worker — Codex, Claude,
// and OpenCode alike — starts and resumes at full access. Worker containment is
// the task worktree, stage ownership, and the worktree-local protected-ref
// pre-push hook, not a provider sandbox.
export const ORCHESTRATOR_WORKER_RUNTIME_MODE: RuntimeMode = "full-access";

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
