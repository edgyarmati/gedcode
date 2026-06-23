import type { OrchestrationStageRole } from "@t3tools/contracts";

// Human-readable labels for the orchestration stage roles, shared by every
// orchestrator surface (stage timeline, per-role config editors) so the role
// vocabulary stays consistent and is defined once.
export const STAGE_ROLE_LABELS: Record<OrchestrationStageRole, string> = {
  classify: "Classify",
  plan: "Plan",
  review: "Review",
  work: "Work",
  verify: "Verify",
};
