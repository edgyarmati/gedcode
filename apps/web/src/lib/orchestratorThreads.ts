import { type OrchestrationThreadOwnership, type ProjectId, ThreadId } from "@t3tools/contracts";

// Orchestrator-owned threads must not appear in the normal chat thread list;
// they are reached from the orchestrator workspace / task detail view instead.
//
// Ownership is persisted when orchestration creates a thread. Unclassified
// legacy threads intentionally remain visible; no id or branch heuristic is
// used to retrofit ownership.
const PM_THREAD_ID_PREFIX = "pm:";

export function pmThreadIdForProject(projectId: ProjectId): ThreadId {
  return ThreadId.make(`${PM_THREAD_ID_PREFIX}${projectId}`);
}

export interface OrchestratorManagedThreadFields {
  readonly orchestrationOwnership?: OrchestrationThreadOwnership | null;
}

/**
 * True when a thread is orchestrator-owned (PM chat or a worker stage thread)
 * and should be excluded from the chat sidebar's thread list.
 */
export function isOrchestratorManagedThread(thread: OrchestratorManagedThreadFields): boolean {
  return thread.orchestrationOwnership !== undefined && thread.orchestrationOwnership !== null;
}
