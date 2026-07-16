import type { RuntimeMode } from "@t3tools/contracts";

export const ORCHESTRATOR_WORKER_RUNTIME_MODE: RuntimeMode = "full-access";

// Codex workers override this provider-neutral default at session admission:
// workspace-write plus Codex auto-review replaces danger-full-access. Claude
// and OpenCode workers continue to use this full-access default.

// PM sessions coordinate through orchestration tools and must not receive the
// unrestricted worker command surface. For Codex, approval-required maps to
// the read-only sandbox with on-request approvals.
export const ORCHESTRATOR_PM_RUNTIME_MODE: RuntimeMode = "approval-required";
