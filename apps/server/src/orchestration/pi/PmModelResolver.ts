/**
 * PM model / provider / credential resolution — the single place the
 * orchestrator's PM runtime is allowed to touch `@earendil-works/pi-ai`.
 *
 * Keeping these calls behind this module preserves the boundary "no
 * `@earendil-works/pi` import outside `orchestration/pi/`" (Plan 017/018
 * done-criterion): the rest of the server depends on this thin wrapper, not on
 * pi-ai's surface directly, so the pi coupling stays contained in `pi/`.
 *
 * @module pi/PmModelResolver
 */
import { getEnvApiKey, getModel, type Model } from "@earendil-works/pi-ai";
import type { PiProviderConfig, ServerSettings } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { PiOAuthCredentialStoreShape } from "./PiOAuthCredentialStore.ts";
import { getPiProviderKind } from "./PiProviderCatalog.ts";

/** A resolved pi model handle, opaque to callers outside `pi/`. */
export type PiModel = Model<any>;

export type ResolvedPiCredential = {
  readonly apiKey?: string | undefined;
};

export class PiCredentialResolutionError extends Data.TaggedError("PiCredentialResolutionError")<{
  readonly provider: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return `Pi credential resolution failed for ${this.provider}: ${this.reason}`;
  }
}

/** PM config stores the pi provider id directly. */
export const resolvePiProvider = (piProvider: string): string => piProvider;

/** Resolve a pi-ai model handle for a provider + model id, or `undefined`. */
export const resolvePiModel = (provider: string, model: string): PiModel | undefined =>
  getModel(provider as never, model as never) as PiModel | undefined;

const configuredPiProvider = (
  settings: ServerSettings,
  provider: string,
): PiProviderConfig | undefined =>
  (settings.piProviders as Record<string, PiProviderConfig | undefined>)[provider];

const envCredential = (provider: string): ResolvedPiCredential | undefined => {
  const apiKey = getEnvApiKey(provider);
  if (apiKey === undefined) {
    return undefined;
  }
  return apiKey === "<authenticated>" ? {} : { apiKey };
};

export const resolvePiCredential = (input: {
  readonly provider: string;
  readonly settings: ServerSettings;
  readonly oauthStore: PiOAuthCredentialStoreShape;
}): Effect.Effect<ResolvedPiCredential, PiCredentialResolutionError> =>
  Effect.gen(function* () {
    const config = configuredPiProvider(input.settings, input.provider);
    const kind = getPiProviderKind(input.provider);

    if (kind === "apiKey") {
      const configuredApiKey = config?.apiKey?.value;
      if (configuredApiKey !== undefined && configuredApiKey.length > 0) {
        return { apiKey: configuredApiKey };
      }
      const env = envCredential(input.provider);
      if (env !== undefined) {
        return env;
      }
      return yield* new PiCredentialResolutionError({
        provider: input.provider,
        reason: "no API key configured in pi provider settings or environment",
      });
    }

    if (kind === "oauth") {
      if (config?.oauth?.connected === true) {
        const apiKey = yield* input.oauthStore.getAccessToken(input.provider).pipe(
          Effect.mapError(
            (cause) =>
              new PiCredentialResolutionError({
                provider: input.provider,
                reason: "failed to resolve OAuth access token",
                cause,
              }),
          ),
        );
        return { apiKey };
      }
      const env = envCredential(input.provider);
      if (env !== undefined) {
        return env;
      }
      return yield* new PiCredentialResolutionError({
        provider: input.provider,
        reason: "no OAuth credential configured in pi provider settings or environment",
      });
    }

    return envCredential(input.provider) ?? {};
  });
