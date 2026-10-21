/**
 * What every agent with GedCode's MCP server is told about Ged. It rides in the
 * per-turn orchestration instructions, the channel agents reliably follow; MCP
 * server instructions alone were not enough to make them call the tool. The
 * text is the same for every project, so it covers one with `.ged/` and one
 * without.
 */
export const GED_AGENT_INSTRUCTIONS = `

## GedCode project memory (Ged)

Before your first reply in a thread, call \`ged_memory_list\` on the \`t3-code\` MCP server, even when the request looks simple. If it reports \`setUp\`, this project uses Ged: before non-trivial work, read the 'lead' playbook with \`ged_playbook\` and follow it. It asks you to clarify intent with the user first ('grilling') when you cannot yet state the acceptance criteria, and says how to delegate and verify. Independent review is required by default; check \`ged_land_check\` before proposing a merge.


Before delegating verifiers, re-read \`ged_memory_list\` and its effective \`reviewPolicy\` (requirement, scope, reason, validity and gate support). Only an explicit user request may skip independent review: infer project-wide versus current-change scope from their words; if unclear, ask one targeted question: "For this change only, or for this project?" Use \`ged_review_policy_set\` with scope, mode and reason; use mode \`required\` to restore reviews. Never opt out automatically because of task size, cost, exhausted quota or failed review. Keep all normal checks. Report "independent review SKIPPED", never passed; do not invent a verdict.

Cross-vendor review is preferred, never a subscription gate. Check available catalogs and known usage; unknown quota telemetry is not confirmed exhaustion. When no capable other-vendor reviewer can run, or an attempt fails due to provider availability, authentication, subscription or quota, automatically delegate a strong same-provider reviewer in a fresh context. Announce the reason and pass it to the verifier for \`ged_verdict_write.selectionReason\`; never fabricate \`otherVendorAvailable\` or repeatedly retry an exhausted provider. Do not ask the user to buy/enable another subscription or disable a provider. Important changes still need two independent fresh review contexts, both on the available provider if necessary. Actual failing findings remain blocking; provider operational failure is not a pass. If no provider can review, report pending/unavailable; only the user can explicitly opt out, and scope never shrinks because of quota.

Project skip is local to this Git repository across threads and linked worktrees. Change skip needs the exact full branch and final committed HEAD after checks and a clean checkout; retain early intent conversationally until then. Never grant a next-commit exemption or transfer an existing one after amend/rebase/new commits without a fresh explicit request. Project reset clears all local exemptions; change reset clears only the current branch and can still inherit project skip. Missing policy requires review; invalid policy cannot grant skip. Stock legacy gates need explicit preview/apply with \`ged_review_gate_update\`; custom gates need manual integration, never silent overwrite. Consult gate support and obey \`ged_land_check\`.

If it reports \`setUp\` false, Ged is not set up here. When \`offerSetup\` is true, this is the first thread in the project to find that out: before starting on the request, ask the user once, in a sentence, whether they want Ged set up, and if they do, use \`ged_init\`. When \`offerSetup\` is false, do not bring it up; if the user asks for it, \`ged_init\` previews and adds the starter files.
`;
