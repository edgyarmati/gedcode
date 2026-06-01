import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerSettingsService } from "../../serverSettings.ts";
import {
  GedRoleInvocationInputError,
  GedRoleInvocationService,
  type GedRoleInvocationInput,
  type GedRoleInvocationServiceShape,
} from "../Services/GedRoleInvocationService.ts";
import { GED_ROLE_PROMPT_DEFINITIONS } from "../GedRolePrompts.ts";

const INVOCATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const validateInput = (input: GedRoleInvocationInput) =>
  Effect.gen(function* () {
    if (!(input.role in GED_ROLE_PROMPT_DEFINITIONS)) {
      return yield* new GedRoleInvocationInputError({
        detail: `Unsupported Ged role: ${input.role}`,
      });
    }

    const invocationId = input.invocationId;
    if (!INVOCATION_ID_PATTERN.test(invocationId)) {
      return yield* new GedRoleInvocationInputError({
        detail:
          "invocationId must be 1-128 chars and contain only letters, digits, underscore, or hyphen",
      });
    }

    if (input.request.trim().length === 0) {
      return yield* new GedRoleInvocationInputError({ detail: "request is required" });
    }

    return { ...input, invocationId, request: input.request.trim() };
  });

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;

  const invoke: GedRoleInvocationServiceShape["invoke"] = (rawInput) =>
    Effect.gen(function* () {
      yield* validateInput(rawInput);
      const settings = yield* settingsService.getSettings;
      if (!settings.gedSubagentsEnabled) {
        return yield* new GedRoleInvocationInputError({
          detail: "Ged subagents are disabled",
        });
      }
      return yield* new GedRoleInvocationInputError({
        detail: "Ged role child threads are disabled; use harness-native subagents",
      });
    });

  return { invoke } satisfies GedRoleInvocationServiceShape;
});

export const GedRoleInvocationServiceLive = Layer.effect(GedRoleInvocationService, make);
