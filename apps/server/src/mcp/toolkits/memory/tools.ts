import { OrchestratorMcpFailure, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ProjectMemory from "../../../ged/ProjectMemory.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    ProjectMemory.ProjectMemory,
  ],
};

/** Named explicitly so a caller cannot invent a role the project has no brief for. */
const Role = Schema.Literals(["planner", "implementer", "verifier"]);

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
    "List the Ged project memory documents for the calling thread's checkout: role briefs, model policy, standards, decisions, and existing verdict records. Read the ones relevant to your role before planning or verifying.",
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Defaults to the calling thread." }),
    ),
  }),
  success: Schema.Struct({
    documents: Schema.Array(Schema.Struct({ key: Schema.String, bytes: Schema.Number })),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const MemoryReadTool = Tool.make("ged_memory_read", {
  ...shared,
  description:
    "Read one Ged project memory document by its key, as ged_memory_list reports it (for example 'roles/verifier.md' or 'STANDARDS.md').",
  parameters: Schema.Struct({
    key: TrimmedNonEmptyString,
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({ key: Schema.String, content: Schema.String }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const RoleBriefTool = Tool.make("ged_role_brief", {
  ...shared,
  description:
    "Read the brief for one role plus the project's model policy, in a single call. A task lead calls this before delegating, so the child's brief comes from project memory rather than from the lead's own recollection.",
  parameters: Schema.Struct({ role: Role, threadId: Schema.optional(ThreadId) }),
  success: Schema.Struct({
    role: Role,
    brief: Schema.String,
    modelPolicy: Schema.NullOr(Schema.String),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const VerdictWriteTool = Tool.make("ged_verdict_write", {
  ...shared,
  description:
    "Record a verifier's ruling for a branch. Nothing lands without one: ged_land_check and the pre-push gate both refuse a branch whose verdict is missing, stale, failing, or produced by the same vendor that implemented the change. Write this from the VERIFIER's findings, never from the implementer's self-assessment. headSha must be the commit actually reviewed; the gate compares it against the live head and blocks on any mismatch.",
  parameters: Schema.Struct({
    branch: TrimmedNonEmptyString,
    headSha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)).annotate({
      description: "The full 40-character SHA the verifier reviewed.",
    }),
    status: Schema.Literals(["pass", "fail"]),
    criteria: Schema.Array(VerdictCriterion).check(Schema.isMinLength(1)),
    implementer: Participant,
    verifier: Participant,
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
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const MemoryToolkit = Toolkit.make(
  MemoryListTool,
  MemoryReadTool,
  RoleBriefTool,
  VerdictWriteTool,
  LandCheckTool,
);
