import { GRILLING } from "./grilling.ts";
import { IMPLEMENTER } from "./implementer.ts";
import { LEAD } from "./lead.ts";
import { PLANNER } from "./planner.ts";
import { VERIFIER } from "./verifier.ts";
import { VERIFY } from "./verify.ts";

/**
 * The Ged playbooks and role briefs, served by `ged_playbook` to every provider.
 * They ship with the app rather than living in each project, so they stay generic:
 * a project customises behaviour through its own `.ged/` documents, which these
 * texts tell the agent to read.
 */
export const PLAYBOOKS = {
  lead: LEAD,
  grilling: GRILLING,
  verify: VERIFY,
  planner: PLANNER,
  implementer: IMPLEMENTER,
  verifier: VERIFIER,
} as const;

export type PlaybookName = keyof typeof PLAYBOOKS;

export const PLAYBOOK_NAMES = Object.keys(PLAYBOOKS) as ReadonlyArray<PlaybookName>;
