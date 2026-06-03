/**
 * GedWorkflowService - Service interface for Ged structured development workflow.
 *
 * Provides bootstrap, state retrieval, and prompt injection for the Ged
 * workflow system. Used by turn interceptors to augment provider prompts
 * with workflow context, and by reactors to respond to file-change events.
 *
 * @module GedWorkflowService
 */
import type { GedWorkflowState, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ValidationResult } from "@t3tools/ged-workflow/CheckpointValidation";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface GedWorkflowPromptContext {
  readonly provider?: ProviderDriverKind | undefined;
  readonly providerInstanceId?: ProviderInstanceId | undefined;
}

export interface GedWorkflowServiceShape {
  readonly bootstrap: (projectRoot: string) => Effect.Effect<void>;
  readonly classifyTurn: (projectRoot: string, userInput: string) => Effect.Effect<void>;
  readonly getState: (projectRoot: string) => Effect.Effect<GedWorkflowState>;
  readonly getStateByThreadId: (threadId: string) => Effect.Effect<GedWorkflowState>;
  readonly getWorkflowPromptSuffix: (context?: GedWorkflowPromptContext) => Effect.Effect<string>;
  readonly isEnabled: Effect.Effect<boolean>;
  readonly recordThreadCwd: (threadId: string, cwd: string) => Effect.Effect<void>;
  readonly validateTurnGuards: (projectRoot: string) => Effect.Effect<ValidationResult>;
}

export class GedWorkflowService extends Context.Service<
  GedWorkflowService,
  GedWorkflowServiceShape
>()("gedcode/gedWorkflow/Services/GedWorkflowService") {}
