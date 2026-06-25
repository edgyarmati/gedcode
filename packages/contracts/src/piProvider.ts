import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Open pi provider identifier. The concrete provider catalog is owned by the
 * pi runtime packages; contracts only requires a stable non-empty key so it
 * does not drift from `@earendil-works/pi-ai`.
 */
export const PiProviderId = TrimmedNonEmptyString.pipe(Schema.brand("PiProviderId"));
export type PiProviderId = typeof PiProviderId.Type;

export const PiProviderApiKeyConfig = Schema.Struct({
  value: Schema.String,
  valueRedacted: Schema.optionalKey(Schema.Boolean),
});
export type PiProviderApiKeyConfig = typeof PiProviderApiKeyConfig.Type;

export const PiProviderOAuthConfig = Schema.Struct({
  connected: Schema.Boolean,
  expiresAt: Schema.optionalKey(Schema.Number),
});
export type PiProviderOAuthConfig = typeof PiProviderOAuthConfig.Type;

export const PiProviderConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  apiKey: Schema.optionalKey(PiProviderApiKeyConfig),
  oauth: Schema.optionalKey(PiProviderOAuthConfig),
});
export type PiProviderConfig = typeof PiProviderConfig.Type;

export const PiProviderConfigMap = Schema.Record(PiProviderId, PiProviderConfig);
export type PiProviderConfigMap = typeof PiProviderConfigMap.Type;

export const PiModelSelection = Schema.Struct({
  piProvider: PiProviderId,
  model: TrimmedNonEmptyString,
});
export type PiModelSelection = typeof PiModelSelection.Type;
