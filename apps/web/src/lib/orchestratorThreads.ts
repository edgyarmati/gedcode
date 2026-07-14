import { type ProjectId, ThreadId } from "@t3tools/contracts";

// Orchestrator-owned threads must not appear in the normal chat thread list;
// they are reached from the orchestrator workspace / task detail view instead.
//
// Two kinds are hidden, and both are detectable from the thread SHELL alone
// (branch + id) — no orchestrator task data needs to be loaded, which matters
// because tasks are only subscribed on orchestrator routes, not in chat mode:
//   - the per-project PM chat, whose thread id is `pm:<projectId>`
//   - worker stage threads, which run on an `orchestrator/<uuid>` branch minted
//     by the orchestrator decider (`orchestrator/<taskId>`)
const PM_THREAD_ID_PREFIX = "pm:";
const ORCHESTRATOR_STAGE_BRANCH_PREFIX = "orchestrator/";

export function pmThreadIdForProject(projectId: ProjectId): ThreadId {
  return ThreadId.make(`${PM_THREAD_ID_PREFIX}${projectId}`);
}

export interface OrchestratorManagedThreadFields {
  readonly id: string;
  readonly branch: string | null;
}

export function isPmThreadId(threadId: string): boolean {
  return threadId.startsWith(PM_THREAD_ID_PREFIX);
}

export function isOrchestratorStageBranch(branch: string | null): boolean {
  return branch !== null && branch.startsWith(ORCHESTRATOR_STAGE_BRANCH_PREFIX);
}

/**
 * True when a thread is orchestrator-owned (PM chat or a worker stage thread)
 * and should be excluded from the chat sidebar's thread list.
 */
export function isOrchestratorManagedThread(thread: OrchestratorManagedThreadFields): boolean {
  return isPmThreadId(thread.id) || isOrchestratorStageBranch(thread.branch);
}
