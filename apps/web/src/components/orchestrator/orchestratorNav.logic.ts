import type { LastOrchestratorProject } from "../../uiStateStore";

/**
 * Resolve where the "Orchestrator" sidebar toggle should land the user.
 *
 * Prefer the last-visited orchestrator project workspace so switching to
 * orchestrator mode feels like returning to where you left off. Fall back to
 * `null` (meaning: the bare project grid at `/orch`) either when nothing has
 * been visited yet or when the remembered project no longer exists — projects
 * come and go across environments, so a stale reference must not strand the
 * user on a dead route.
 */
export function resolveOrchestratorLandingTarget(input: {
  readonly lastProject: LastOrchestratorProject | null;
  readonly projectExists: (ref: LastOrchestratorProject) => boolean;
}): LastOrchestratorProject | null {
  const { lastProject, projectExists } = input;
  if (!lastProject) {
    return null;
  }
  return projectExists(lastProject) ? lastProject : null;
}
