import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { ProjectContextSnapshot } from "../ProjectContext.ts";

export class ProjectContextScannerError extends Schema.TaggedErrorClass<ProjectContextScannerError>()(
  "ProjectContextScannerError",
  {
    workspaceRoot: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
  },
) {}

export interface ProjectContextScannerShape {
  readonly scan: (
    workspaceRoot: string,
  ) => Effect.Effect<ProjectContextSnapshot, ProjectContextScannerError>;
}

export class ProjectContextScanner extends Context.Service<
  ProjectContextScanner,
  ProjectContextScannerShape
>()("gedcode/project/Services/ProjectContextScanner") {}
