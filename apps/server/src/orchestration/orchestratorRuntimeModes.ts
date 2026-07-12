import type { RuntimeMode } from "@t3tools/contracts";

export const ORCHESTRATOR_WORKER_RUNTIME_MODE: RuntimeMode = "full-access";

// PM sessions coordinate through orchestration tools and must not receive the
// unrestricted worker command surface. For Codex, approval-required maps to
// the read-only sandbox with on-request approvals.
export const ORCHESTRATOR_PM_RUNTIME_MODE: RuntimeMode = "approval-required";
