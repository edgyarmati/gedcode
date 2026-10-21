import { OrchestratorMcpFailure, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as GedSetup from "../../../ged/GedSetup.ts";
import * as GedSetupOffers from "../../../ged/GedSetupOffers.ts";
import * as ProjectMemory from "../../../ged/ProjectMemory.ts";
import { ReviewPolicyInput } from "../../../ged/reviewPolicyScript.ts";
import { PLAYBOOK_NAMES } from "../../../ged/playbooks/index.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    ProjectMemory.ProjectMemory,
    GedSetup.GedSetup,
    GedSetupOffers.GedSetupOffers,
    OrchestratorMcpService.OrchestratorMcpService,
  ],
};

const PlaybookName = Schema.Literals(PLAYBOOK_NAMES);

const CriterionVerdict = Schema.Literals(["met", "not_met", "unverifiable"]);

const VerdictCriterion = Schema.Struct({
  criterion: TrimmedNonEmptyString.annotate({
    description: "The acceptance criterion, copied from the brief, not reworded.",
  }),
  verdict: CriterionVerdict.annotate({
    description:
      "unverifiable means the criterion was not written to be checkable. It is NOT a pass and will block the land gate.",
  }),
  evidence: TrimmedNonEmptyString.annotate({
    description:
      "What establishes the verdict: a test name, a file:line, or command output. Not a restatement of the criterion.",
  }),
});

const Participant = Schema.Struct({
  driverKind: TrimmedNonEmptyString.annotate({
    description:
      "The provider driver kind, e.g. codex, claudeAgent, cursor, grok, muse, pi, acpRegistry, opencode.",
  }),
  model: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
});

const MemoryListTool = Tool.make("ged_memory_list", {
  ...shared,
  description:
    "List Ged memory and effective local reviewPolicy, including reason and gate support. Read before work and again before delegating verifiers. Review is required by default; only an explicit user request permits ged_review_policy_set. setUp is false without .ged/; offerSetup is true only the first time for a project.",
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Defaults to the calling thread." }),
    ),
  }),
  success: Schema.Struct({
    documents: Schema.Array(Schema.Struct({ key: Schema.String, bytes: Schema.Number })),
    setUp: Schema.Boolean,
    offerSetup: Schema.Boolean,
    reviewPolicy: ProjectMemory.ReviewStatus,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const MemoryReadTool = Tool.make("ged_memory_read", {
  ...shared,
  description:
    "Read one Ged project memory document by its key, as ged_memory_list reports it (for example 'STANDARDS.md' or 'plans/INDEX.md').",
  parameters: Schema.Struct({
    key: TrimmedNonEmptyString,
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({ key: Schema.String, content: Schema.String }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const PlaybookTool = Tool.make("ged_playbook", {
  ...shared,
  description:
    "Read a Ged playbook. In a project with Ged memory (.ged/), fetch 'lead' before non-trivial work and follow it; it says when to fetch 'grilling' (clarify intent with the user first), 'verify' (the narrow checks), and the role briefs 'planner', 'implementer' and 'verifier' that a lead pastes verbatim into a delegated child's prompt.",
  parameters: Schema.Struct({ name: PlaybookName }),
  success: Schema.Struct({ name: PlaybookName, content: Schema.String }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const VerdictWriteTool = Tool.make("ged_verdict_write", {
  ...shared,
  description:
    "Record one verifier's ruling for a branch when review is required. ged_land_check and the pre-push gate refuse a missing, stale or failing verdict unless the user explicitly opted out. Never write a fake verdict for skipped review. All recorded reviews must pass. Cross-vendor review is preferred; fresh same-provider review is accepted with a warning, even when another vendor is installed. Record the selection/fallback reason; installed availability is server-derived and informational. Provider operational failure is not a passing review. Write the VERIFIER's findings, never the implementer's self-assessment. headSha must be the commit actually reviewed.",
  parameters: Schema.Struct({
    branch: TrimmedNonEmptyString,
    headSha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)).annotate({
      description: "The full 40-character SHA the verifier reviewed.",
    }),
    status: Schema.Literals(["pass", "fail"]),
    criteria: Schema.Array(VerdictCriterion).check(Schema.isMinLength(1)),
    implementer: Participant,
    verifier: Participant,
    selectionReason: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(500)).annotate({
        description:
          "Why this reviewer was selected (max 500 characters), including actual provider unavailability/authentication/subscription/quota failures. Do not guess exhaustion from unknown quota telemetry.",
      }),
    ),
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({ path: Schema.String, ruling: Schema.String }),
}).annotate(Tool.Destructive, true);

const LandCheckTool = Tool.make("ged_land_check", {
  ...shared,
  description:
    "Ask the land gate whether the calling thread's branch may merge. Runs the project's own .ged/bin/land-gate.sh, so this answer is the same answer a pre-push hook gives. Call it before proposing a merge; a blocked result tells you what is missing.",
  parameters: Schema.Struct({ threadId: Schema.optional(ThreadId) }),
  success: Schema.Struct({
    allowed: Schema.Boolean,
    outcome: Schema.Literals(["allowed", "blocked", "error"]),
    detail: Schema.String,
  }),
})
  // Not read-only: it executes .ged/bin/land-gate.sh from the checkout.
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

const InitTool = Tool.make("ged_init", {
  ...shared,
  description:
    "Set up Ged in the calling thread's project by adding the starter .ged/ files it lacks (project, standards with a Checks section, decisions, context map, progress, model notes, plan index, verdicts and the land gate). Only when the user asks. Call first without apply to preview, show the user the list, and call again with apply: true once they agree. Existing files are never changed.",
  parameters: Schema.Struct({
    apply: Schema.optional(Schema.Boolean).annotate({
      description: "false or omitted previews; true writes the missing files.",
    }),
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({
    applied: Schema.Boolean,
    missing: Schema.Array(Schema.String),
    present: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Destructive, false);

const ReviewPolicySetTool = Tool.make("ged_review_policy_set", {
  ...shared,
  description:
    "Only on an explicit user request: skip or require independent review locally. Infer project versus current change from the request; if unclear ask one targeted question. Never infer skip from cost, size, quota or failed review. Change skip requires exact branch and final committed headSha with a clean checkout; never transfer it to another commit. Project required clears ALL local exemptions; change required removes only this branch and may inherit project skip. Normal checks remain required. Read gate support in the result; upgrade stock legacy gates explicitly with ged_review_gate_update. Report review SKIPPED, never passed.",
  parameters: Schema.Struct({ ...ReviewPolicyInput.fields, threadId: Schema.optional(ThreadId) }),
  success: ProjectMemory.ReviewStatus,
}).annotate(Tool.Destructive, true);

const ReviewGateUpdateTool = Tool.make("ged_review_gate_update", {
  ...shared,
  description:
    "Preview the installed review gate; apply: true explicitly upgrades only exact known stock gates from before or after manual opt-outs to the current review policy. Customized and missing gates are preserved; integrate the current starter manually or use ged_init for missing files. Setup itself remains add-missing-only. Show preview before applying.",
  parameters: Schema.Struct({
    apply: Schema.optional(Schema.Boolean),
    threadId: Schema.optional(ThreadId),
  }),
  success: ProjectMemory.GateUpdate,
}).annotate(Tool.Destructive, false);

export const MemoryToolkit = Toolkit.make(
  MemoryListTool,
  MemoryReadTool,
  PlaybookTool,
  VerdictWriteTool,
  LandCheckTool,
  InitTool,
  ReviewPolicySetTool,
  ReviewGateUpdateTool,
);
