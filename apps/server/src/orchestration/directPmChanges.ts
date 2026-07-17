import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import {
  commitTaskWorktreeChanges,
  inspectTaskWorktreeChanges,
  type TaskWorktreeChanges,
} from "./taskChangeReview.ts";

export interface DirectPmCheckEvidence {
  readonly command: string;
  readonly outcome: string;
}

export interface DirectPmCommitResult {
  readonly commit: string;
  readonly rationale: string;
  readonly checks: ReadonlyArray<DirectPmCheckEvidence>;
  readonly changes: TaskWorktreeChanges;
}

export class DirectPmChangeError extends Data.TaggedError("DirectPmChangeError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

const requireRationale = (rationale: string) => {
  const normalized = rationale.trim();
  return normalized.length >= 20 && normalized.split(/\s+/u).length >= 4
    ? Effect.succeed(normalized)
    : Effect.fail(
        new DirectPmChangeError({
          detail: "Explain why this change is bounded and low risk before committing it directly.",
        }),
      );
};

const requireCheckEvidence = (checks: ReadonlyArray<DirectPmCheckEvidence>) => {
  const normalized = checks.map((check) => ({
    command: check.command.trim(),
    outcome: check.outcome.trim(),
  }));
  if (
    normalized.length === 0 ||
    normalized.length > 8 ||
    normalized.some((check) => check.command.length === 0 || check.outcome.length === 0)
  ) {
    return Effect.fail(
      new DirectPmChangeError({
        detail: "Provide one to eight proportional check commands with their observed outcomes.",
      }),
    );
  }
  return Effect.succeed(normalized);
};

export const inspectDirectPmChanges = Effect.fn("inspectDirectPmChanges")(function* (input: {
  readonly workspaceRoot: string;
  readonly process: Pick<VcsProcessShape, "run">;
}) {
  return yield* inspectTaskWorktreeChanges({
    worktreePath: input.workspaceRoot,
    process: input.process,
  });
});

/**
 * Commit an exact reviewed patch from the primary checkout. Patch-only
 * selection is intentional: path-level staging could absorb unrelated user
 * edits from the same file, while an exact patch preserves every unselected
 * hunk in the working tree.
 */
export const commitDirectPmChanges = Effect.fn("commitDirectPmChanges")(function* (input: {
  readonly workspaceRoot: string;
  readonly process: Pick<VcsProcessShape, "run">;
  readonly patch: string;
  readonly message: string;
  readonly rationale: string;
  readonly checks: ReadonlyArray<DirectPmCheckEvidence>;
}) {
  const rationale = yield* requireRationale(input.rationale);
  const checks = yield* requireCheckEvidence(input.checks);
  const result = yield* commitTaskWorktreeChanges({
    worktreePath: input.workspaceRoot,
    process: input.process,
    patch: input.patch,
    message: input.message,
  });
  return {
    commit: result.changes.head,
    rationale,
    checks,
    changes: result.changes,
  } satisfies DirectPmCommitResult;
});
