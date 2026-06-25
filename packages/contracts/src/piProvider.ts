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

export const PiProviderCatalogKind = Schema.Literals(["apiKey", "oauth", "ambient"]);
export type PiProviderCatalogKind = typeof PiProviderCatalogKind.Type;

export const PiProviderCatalogEntry = Schema.Struct({
  id: PiProviderId,
  displayName: TrimmedNonEmptyString,
  kind: PiProviderCatalogKind,
  envKeys: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  configured: Schema.Boolean,
  enabled: Schema.Boolean,
});
export type PiProviderCatalogEntry = typeof PiProviderCatalogEntry.Type;

export const PiProviderCatalogResult = Schema.Struct({
  providers: Schema.Array(PiProviderCatalogEntry),
});
export type PiProviderCatalogResult = typeof PiProviderCatalogResult.Type;

export const PiProviderModelsInput = Schema.Struct({
  provider: PiProviderId,
});
export type PiProviderModelsInput = typeof PiProviderModelsInput.Type;

export const PiProviderModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  contextWindow: Schema.Number,
});
export type PiProviderModel = typeof PiProviderModel.Type;

export const PiProviderModelsResult = Schema.Struct({
  models: Schema.Array(PiProviderModel),
});
export type PiProviderModelsResult = typeof PiProviderModelsResult.Type;
