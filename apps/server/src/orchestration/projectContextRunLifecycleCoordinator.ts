import type { ProjectContextRunId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

interface ProjectContextRunLockEntry {
  readonly semaphore: Semaphore.Semaphore;
  users: number;
}

const projectContextRunLocks = new Map<string, ProjectContextRunLockEntry>();

function acquireLockEntry(runId: ProjectContextRunId): ProjectContextRunLockEntry {
  const key = String(runId);
  const existing = projectContextRunLocks.get(key);
  if (existing !== undefined) {
    existing.users += 1;
    return existing;
  }

  const created = { semaphore: Semaphore.makeUnsafe(1), users: 1 };
  projectContextRunLocks.set(key, created);
  return created;
}

function releaseLockEntry(runId: ProjectContextRunId, entry: ProjectContextRunLockEntry): void {
  entry.users -= 1;
  if (entry.users === 0 && projectContextRunLocks.get(String(runId)) === entry) {
    projectContextRunLocks.delete(String(runId));
  }
}

/**
 * Serializes destructive project-context review actions in this process. The
 * append-only event stream is still the durable authority; this lock closes
 * the check/mutate race between simultaneous Commit, Revise, and Discard UI
 * requests for one context run.
 */
export function withProjectContextRunLifecycleLock<A, E, R>(
  runId: ProjectContextRunId,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const entry = acquireLockEntry(runId);
    return entry.semaphore.withPermit(effect).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          releaseLockEntry(runId, entry);
        }),
      ),
    );
  });
}
