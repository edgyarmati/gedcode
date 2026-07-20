import {
  buildOrchestratorTaskBranchName,
  withOrchestratorTaskBranchCollisionSuffix,
} from "@t3tools/shared/git";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";

const ZERO_OID = "0000000000000000000000000000000000000000";
const MAX_COLLISION_ATTEMPTS = 1_000;

export class TaskBranchReservationError extends Data.TaggedError("TaskBranchReservationError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface TaskBranchReservation {
  readonly branch: string;
  readonly head: string;
}

function candidateFor(base: string, attempt: number): string {
  return attempt === 1 ? base : withOrchestratorTaskBranchCollisionSuffix(base, attempt);
}

/** Atomically reserve a new local task branch at the repository's current HEAD. */
export const reserveTaskBranch = Effect.fn("reserveTaskBranch")(function* (input: {
  readonly vcsProcess: VcsProcessShape;
  readonly cwd: string;
  readonly taskType: string;
  readonly title: string;
}) {
  const headResult = yield* input.vcsProcess
    .run({
      operation: "TaskBranchReservation.resolveHead",
      command: "git",
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: input.cwd,
      timeoutMs: 10_000,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TaskBranchReservationError({
            detail: `Could not resolve HEAD before reserving an orchestrator task branch in '${input.cwd}'.`,
            cause,
          }),
      ),
    );
  const head = headResult.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(head)) {
    return yield* new TaskBranchReservationError({
      detail: `Git returned an invalid HEAD object id while reserving an orchestrator task branch in '${input.cwd}'.`,
    });
  }

  const base = buildOrchestratorTaskBranchName(input.taskType, input.title);
  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
    const branch = candidateFor(base, attempt);
    const ref = `refs/heads/${branch}`;
    const createResult = yield* input.vcsProcess
      .run({
        operation: "TaskBranchReservation.create",
        command: "git",
        args: ["update-ref", ref, head, ZERO_OID],
        cwd: input.cwd,
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TaskBranchReservationError({
              detail: `Could not reserve orchestrator task branch '${branch}'.`,
              cause,
            }),
        ),
      );
    if (createResult.exitCode === 0) {
      return { branch, head } satisfies TaskBranchReservation;
    }

    const collisionResult = yield* input.vcsProcess
      .run({
        operation: "TaskBranchReservation.inspectCollision",
        command: "git",
        args: ["show-ref", "--verify", "--quiet", ref],
        cwd: input.cwd,
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TaskBranchReservationError({
              detail: `Could not inspect the failed reservation for '${branch}'.`,
              cause,
            }),
        ),
      );
    if (collisionResult.exitCode !== 0) {
      return yield* new TaskBranchReservationError({
        detail:
          createResult.stderr.trim() ||
          `Git rejected orchestrator task branch '${branch}' for a reason other than a name collision.`,
      });
    }
  }

  return yield* new TaskBranchReservationError({
    detail: `Could not reserve an available branch derived from '${base}' after ${MAX_COLLISION_ATTEMPTS} attempts.`,
  });
});

/** Compensate a failed task dispatch without deleting a branch that has moved. */
export const releaseTaskBranchReservation = Effect.fn("releaseTaskBranchReservation")(
  function* (input: {
    readonly vcsProcess: VcsProcessShape;
    readonly cwd: string;
    readonly reservation: TaskBranchReservation;
  }) {
    const result = yield* input.vcsProcess
      .run({
        operation: "TaskBranchReservation.release",
        command: "git",
        args: [
          "update-ref",
          "-d",
          `refs/heads/${input.reservation.branch}`,
          input.reservation.head,
        ],
        cwd: input.cwd,
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TaskBranchReservationError({
              detail: `Could not release failed task branch reservation '${input.reservation.branch}'.`,
              cause,
            }),
        ),
      );
    if (result.exitCode !== 0) {
      return yield* new TaskBranchReservationError({
        detail:
          result.stderr.trim() ||
          `Git refused to release failed task branch reservation '${input.reservation.branch}' because it no longer points at the reserved object.`,
      });
    }
  },
);
