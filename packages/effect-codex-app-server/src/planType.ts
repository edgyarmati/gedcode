import * as Schema from "effect/Schema";

// Verified against codex-cli 0.149.1 on 2026-09-08:
// codex app-server generate-json-schema --experimental --out <temporary-directory>
// v2/GetAccountResponse.json definitions.PlanType. Share the closed enum across
// generated account and rate-limit schemas so the provider probe and runtime agree.
export const CodexPlanType = Schema.Literals([
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "team",
  "self_serve_business_prolite",
  "self_serve_business_usage_based",
  "business",
  "ent26",
  "enterprise_cbp_automation",
  "enterprise_cbp_usage_based",
  "enterprise",
  "edu",
  "edu_plus",
  "edu_pro",
  "unknown",
]);
