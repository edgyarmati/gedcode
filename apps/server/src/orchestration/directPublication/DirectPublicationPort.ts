import { type ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export interface DirectPublicationInput {
  readonly projectId: ProjectId;
  readonly sourceCommit: string;
  readonly destinationBranch: string;
  readonly baseBranch: string;
  readonly pullRequest: {
    readonly title: string;
    readonly body: string;
  };
  readonly existingPullRequestUrl: string | null;
}

export interface DirectPublicationResult {
  readonly pullRequestUrl: string;
  readonly sourceCommit: string;
  readonly destinationBranch: string;
}

export class DirectPublicationError extends Data.TaggedError("DirectPublicationError")<{
  readonly reason:
    | "project-invalid"
    | "checkout-dirty"
    | "source-commit-invalid"
    | "destination-protected"
    | "destination-mismatch"
    | "pull-request-mismatch"
    | "cherry-pick-conflict"
    | "push-failed"
    | "provider-failed"
    | "cleanup-failed";
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface DirectPublicationPortShape {
  readonly publish: (
    input: DirectPublicationInput,
  ) => Effect.Effect<DirectPublicationResult, DirectPublicationError>;
}

/**
 * Narrow taskless publication boundary. Implementations may publish exactly
 * one existing commit; this is intentionally not a generic Git command port.
 */
export class DirectPublicationPort extends Context.Service<
  DirectPublicationPort,
  DirectPublicationPortShape
>()("gedcode/orchestration/directPublication/DirectPublicationPort") {}
