/**
 * GedWorkflowTurnInterceptor - Appends Ged workflow context to provider turn input.
 *
 * Pure function that takes a `ProviderSendTurnInput` and enriches the user
 * message with workflow prompt context. Idempotent: if the marker is already
 * present in the input, the original input is returned unchanged.
 *
 * @module GedWorkflowTurnInterceptor
 */
import type { ProviderSendTurnInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { GedWorkflowService } from "../Services/GedWorkflowService.ts";

const WORKFLOW_CONTEXT_MARKER = "[ged-workflow-context-injected]";

export const injectWorkflowContext = (
  input: ProviderSendTurnInput,
  _projectRoot: string,
): Effect.Effect<ProviderSendTurnInput, never, GedWorkflowService> =>
  Effect.gen(function* () {
    const workflow = yield* GedWorkflowService;
    if (!input.input) return input;
    if (input.input.includes(WORKFLOW_CONTEXT_MARKER)) return input;

    const suffix = yield* workflow.getWorkflowPromptSuffix();
    const enrichedInput =
      `${input.input}\n\n---\n${WORKFLOW_CONTEXT_MARKER}\n${suffix}` as typeof input.input;

    return {
      ...input,
      input: enrichedInput,
    };
  });
