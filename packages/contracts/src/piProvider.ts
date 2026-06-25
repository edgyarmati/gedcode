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

export const PiOAuthLoginSessionId = TrimmedNonEmptyString.pipe(
  Schema.brand("PiOAuthLoginSessionId"),
);
export type PiOAuthLoginSessionId = typeof PiOAuthLoginSessionId.Type;

export const PiOAuthDeviceCodeInfo = Schema.Struct({
  userCode: TrimmedNonEmptyString,
  verificationUri: TrimmedNonEmptyString,
  intervalSeconds: Schema.optionalKey(Schema.Number),
  expiresInSeconds: Schema.optionalKey(Schema.Number),
});
export type PiOAuthDeviceCodeInfo = typeof PiOAuthDeviceCodeInfo.Type;

export const PiOAuthLoginStartInput = Schema.Struct({
  provider: PiProviderId,
});
export type PiOAuthLoginStartInput = typeof PiOAuthLoginStartInput.Type;

export const PiOAuthLoginStartResult = Schema.Struct({
  sessionId: PiOAuthLoginSessionId,
  provider: PiProviderId,
  authUrl: Schema.optionalKey(TrimmedNonEmptyString),
  instructions: Schema.optionalKey(TrimmedNonEmptyString),
  deviceCode: Schema.optionalKey(PiOAuthDeviceCodeInfo),
});
export type PiOAuthLoginStartResult = typeof PiOAuthLoginStartResult.Type;

export const PiOAuthLoginCompleteInput = Schema.Struct({
  sessionId: PiOAuthLoginSessionId,
  code: Schema.String,
});
export type PiOAuthLoginCompleteInput = typeof PiOAuthLoginCompleteInput.Type;

export const PiOAuthLoginStatus = Schema.Struct({
  connected: Schema.Boolean,
  provider: PiProviderId,
  expiresAt: Schema.optionalKey(Schema.Number),
});
export type PiOAuthLoginStatus = typeof PiOAuthLoginStatus.Type;

export const PiOAuthLoginCancelInput = Schema.Struct({
  sessionId: PiOAuthLoginSessionId,
});
export type PiOAuthLoginCancelInput = typeof PiOAuthLoginCancelInput.Type;

export const PiOAuthLoginCancelResult = Schema.Struct({
  sessionId: PiOAuthLoginSessionId,
  cancelled: Schema.Boolean,
});
export type PiOAuthLoginCancelResult = typeof PiOAuthLoginCancelResult.Type;

export class PiOAuthLoginError extends Schema.TaggedErrorClass<PiOAuthLoginError>()(
  "PiOAuthLoginError",
  {
    reason: TrimmedNonEmptyString,
    provider: Schema.optional(PiProviderId),
    sessionId: Schema.optional(PiOAuthLoginSessionId),
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    const provider = this.provider ? ` for ${this.provider}` : "";
    return `Pi OAuth login failed${provider}: ${this.reason}`;
  }
}
