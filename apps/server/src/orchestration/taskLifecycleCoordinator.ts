import type { TaskId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

interface TaskLockEntry {
  readonly semaphore: Semaphore.Semaphore;
  users: number;
}

const taskLocks = new Map<string, TaskLockEntry>();

function acquireLockEntry(taskId: TaskId): TaskLockEntry {
  const key = String(taskId);
  const existing = taskLocks.get(key);
  if (existing !== undefined) {
    existing.users += 1;
    return existing;
  }

  const created = { semaphore: Semaphore.makeUnsafe(1), users: 1 };
  taskLocks.set(key, created);
  return created;
}

function releaseLockEntry(taskId: TaskId, entry: TaskLockEntry): void {
  entry.users -= 1;
  if (entry.users === 0 && taskLocks.get(String(taskId)) === entry) {
    taskLocks.delete(String(taskId));
  }
}

/**
 * Serializes the two destructive edges of an orchestrator task lifecycle:
 * starting its active worker and cancelling that worker/task. The durable
 * event reservation remains the cross-restart source of truth; this lock
 * closes the in-process check/start and reserve/shutdown races.
 */
export function withTaskLifecycleLock<A, E, R>(
  taskId: TaskId,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const entry = acquireLockEntry(taskId);
    return entry.semaphore.withPermit(effect).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          releaseLockEntry(taskId, entry);
        }),
      ),
    );
  });
}
