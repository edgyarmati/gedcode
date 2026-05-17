/**
 * GedWorkflowService - Service interface for Ged structured development workflow.
 *
 * Provides bootstrap, state retrieval, and prompt injection for the Ged
 * workflow system. Used by turn interceptors to augment provider prompts
 * with workflow context, and by reactors to respond to file-change events.
 *
 * @module GedWorkflowService
 */
import type { GedWorkflowState } from "@t3tools/contracts";
import type { ValidationResult } from "@t3tools/ged-workflow/CheckpointValidation";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface GedWorkflowServiceShape {
  readonly bootstrap: (projectRoot: string) => Effect.Effect<void>;
  readonly getState: (projectRoot: string) => Effect.Effect<GedWorkflowState>;
  readonly getWorkflowPromptSuffix: () => Effect.Effect<string>;
  readonly validateTurnGuards: (projectRoot: string) => Effect.Effect<ValidationResult>;
}

export class GedWorkflowService extends Context.Service<
  GedWorkflowService,
  GedWorkflowServiceShape
>()("t3/gedWorkflow/Services/GedWorkflowService") {}
