import * as Schema from "effect/Schema";

export class PmRuntimeError extends Schema.TaggedErrorClass<PmRuntimeError>()("PmRuntimeError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const toPmRuntimeError =
  (operation: string, detail: string) =>
  (cause: unknown): PmRuntimeError =>
    new PmRuntimeError({ operation, detail, cause });
