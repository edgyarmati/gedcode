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
import { getEnvApiKey, getModel, getProviders, type Model } from "@earendil-works/pi-ai";

/** A resolved pi model handle, opaque to callers outside `pi/`. */
export type PiModel = Model<any>;

/**
 * Map the server's provider instance ids onto pi-ai provider ids. The PM routes
 * through the same provider registry as every other model selection, so the ids
 * usually match; these aliases cover the cases where they differ.
 */
const PI_PROVIDER_ALIASES = new Map<string, string>([
  ["codex", "openai-codex"],
  ["claude", "anthropic"],
  ["claudeAgent", "anthropic"],
  ["openCode", "opencode"],
]);

/** Resolve a server provider instance id to a pi-ai provider id. */
export const resolvePiProvider = (instanceId: string): string => {
  const providers = new Set(getProviders() as ReadonlyArray<string>);
  if (providers.has(instanceId)) {
    return instanceId;
  }
  return PI_PROVIDER_ALIASES.get(instanceId) ?? instanceId;
};

/** Resolve a pi-ai model handle for a provider + model id, or `undefined`. */
export const resolvePiModel = (provider: string, model: string): PiModel | undefined =>
  getModel(provider as never, model as never) as PiModel | undefined;

/** Resolve the configured API key for a pi-ai provider from the environment. */
export const resolvePiApiKey = (provider: string): string | undefined => getEnvApiKey(provider);
