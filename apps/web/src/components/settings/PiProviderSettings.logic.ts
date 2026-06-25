import type {
  PiProviderCatalogEntry,
  PiProviderConfig,
  PiProviderConfigMap,
  PiProviderId,
  ServerSettings,
  UnifiedSettings,
} from "@t3tools/contracts";

function normalizePiProviderConfig(config: PiProviderConfig | undefined): PiProviderConfig {
  return config ?? { enabled: false };
}

export function buildPiProvidersWholeMap(input: {
  readonly settings: Pick<ServerSettings, "piProviders">;
  readonly catalog?: ReadonlyArray<Pick<PiProviderCatalogEntry, "id" | "enabled">> | undefined;
}): PiProviderConfigMap {
  const next: Record<string, PiProviderConfig> = {};
  for (const [provider, config] of Object.entries(input.settings.piProviders)) {
    next[provider] = normalizePiProviderConfig(config);
  }
  for (const entry of input.catalog ?? []) {
    if (next[entry.id] === undefined) {
      next[entry.id] = { enabled: entry.enabled };
    }
  }
  return next as PiProviderConfigMap;
}

export function buildPiProviderEnabledPatch(input: {
  readonly settings: Pick<ServerSettings, "piProviders">;
  readonly catalog?: ReadonlyArray<Pick<PiProviderCatalogEntry, "id" | "enabled">> | undefined;
  readonly provider: PiProviderId;
  readonly enabled: boolean;
}): Pick<UnifiedSettings, "piProviders"> {
  const piProviders = { ...buildPiProvidersWholeMap(input) } as Record<string, PiProviderConfig>;
  piProviders[input.provider] = {
    ...normalizePiProviderConfig(piProviders[input.provider]),
    enabled: input.enabled,
  };
  return { piProviders: piProviders as PiProviderConfigMap };
}

export function buildPiProviderApiKeyPatch(input: {
  readonly settings: Pick<ServerSettings, "piProviders">;
  readonly catalog?: ReadonlyArray<Pick<PiProviderCatalogEntry, "id" | "enabled">> | undefined;
  readonly provider: PiProviderId;
  readonly value: string;
}): Pick<UnifiedSettings, "piProviders"> {
  const piProviders = { ...buildPiProvidersWholeMap(input) } as Record<string, PiProviderConfig>;
  const current = normalizePiProviderConfig(piProviders[input.provider]);
  const trimmed = input.value.trim();
  piProviders[input.provider] = {
    ...current,
    apiKey:
      trimmed.length > 0
        ? { value: trimmed, valueRedacted: false }
        : (current.apiKey ?? { value: "", valueRedacted: true }),
  };
  return { piProviders: piProviders as PiProviderConfigMap };
}

export function buildPiProviderOAuthDisconnectedPatch(input: {
  readonly settings: Pick<ServerSettings, "piProviders">;
  readonly catalog?: ReadonlyArray<Pick<PiProviderCatalogEntry, "id" | "enabled">> | undefined;
  readonly provider: PiProviderId;
}): Pick<UnifiedSettings, "piProviders"> {
  const piProviders = { ...buildPiProvidersWholeMap(input) } as Record<string, PiProviderConfig>;
  const { oauth: _oauth, ...rest } = normalizePiProviderConfig(piProviders[input.provider]);
  piProviders[input.provider] = rest;
  return { piProviders: piProviders as PiProviderConfigMap };
}
