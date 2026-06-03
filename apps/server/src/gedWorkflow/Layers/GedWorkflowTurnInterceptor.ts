import type { ProviderSendTurnInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  GedWorkflowService,
  type GedWorkflowPromptContext,
} from "../Services/GedWorkflowService.ts";

const WORKFLOW_CONTEXT_MARKER = "[ged-workflow-context-injected]";

export const injectWorkflowContext = (
  input: ProviderSendTurnInput,
  context?: GedWorkflowPromptContext,
): Effect.Effect<ProviderSendTurnInput, never, GedWorkflowService> =>
  Effect.gen(function* () {
    const workflow = yield* GedWorkflowService;
    if (!input.input) return input;
    if (input.input.includes(WORKFLOW_CONTEXT_MARKER)) return input;

    const suffix = yield* workflow.getWorkflowPromptSuffix(context);
    const enrichedInput =
      `${input.input}\n\n---\n${WORKFLOW_CONTEXT_MARKER}\n${suffix}` as typeof input.input;

    return {
      ...input,
      input: enrichedInput,
    };
  });

export interface TurnGuardResult {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
}

export const validateTurnGuards = (
  projectRoot: string,
): Effect.Effect<TurnGuardResult, never, GedWorkflowService> =>
  Effect.gen(function* () {
    const workflow = yield* GedWorkflowService;
    if (!(yield* workflow.isEnabled)) return { allowed: true };
    const result = yield* workflow.validateTurnGuards(projectRoot);
    return { allowed: result.valid, reason: result.reason };
  });
