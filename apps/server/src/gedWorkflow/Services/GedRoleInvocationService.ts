import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export type GedRole = "ged-explorer";

export interface GedRoleInvocationInput {
  readonly role: GedRole;
  readonly invocationId: string;
  readonly parentThreadId: ThreadId;
  readonly request: string;
}

export interface GedRoleInvocationResult {
  readonly role: GedRole;
  readonly invocationId: string;
  readonly parentThreadId: ThreadId;
  readonly childThreadId: ThreadId;
}

export class GedRoleInvocationInputError extends Data.TaggedError("GedRoleInvocationInputError")<{
  readonly detail: string;
}> {}

export class GedRoleInvocationContextError extends Data.TaggedError(
  "GedRoleInvocationContextError",
)<{
  readonly detail: string;
}> {}

export class GedRoleInvocationDispatchError extends Data.TaggedError(
  "GedRoleInvocationDispatchError",
)<{
  readonly failedStep: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export type GedRoleInvocationError =
  | GedRoleInvocationInputError
  | GedRoleInvocationContextError
  | GedRoleInvocationDispatchError
  | ProjectionRepositoryError;

export interface GedRoleInvocationServiceShape {
  readonly invoke: (
    input: GedRoleInvocationInput,
  ) => Effect.Effect<GedRoleInvocationResult, GedRoleInvocationError>;
}

export class GedRoleInvocationService extends Context.Service<
  GedRoleInvocationService,
  GedRoleInvocationServiceShape
>()("t3/gedWorkflow/Services/GedRoleInvocationService") {}
