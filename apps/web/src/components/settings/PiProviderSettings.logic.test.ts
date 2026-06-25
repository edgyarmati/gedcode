import { PiProviderId, type PiProviderCatalogEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildPiProviderApiKeyPatch,
  buildPiProviderEnabledPatch,
  buildPiProviderOAuthDisconnectedPatch,
  buildPiProvidersWholeMap,
} from "./PiProviderSettings.logic";

const openrouter = PiProviderId.make("openrouter");
const anthropic = PiProviderId.make("anthropic");
const bedrock = PiProviderId.make("amazon-bedrock");

const catalog = [
  {
    id: openrouter,
    displayName: "OpenRouter",
    kind: "apiKey",
    configured: true,
    enabled: true,
  },
  {
    id: anthropic,
    displayName: "Anthropic",
    kind: "oauth",
    configured: true,
    enabled: true,
  },
  {
    id: bedrock,
    displayName: "Amazon Bedrock",
    kind: "ambient",
    configured: false,
    enabled: false,
  },
] satisfies ReadonlyArray<PiProviderCatalogEntry>;

describe("PiProviderSettings logic", () => {
  it("builds an enable-toggle whole-map patch preserving other redacted providers", () => {
    const patch = buildPiProviderEnabledPatch({
      settings: {
        piProviders: {
          [openrouter]: {
            enabled: true,
            apiKey: { value: "", valueRedacted: true },
          },
          [anthropic]: {
            enabled: true,
            oauth: { connected: true, expiresAt: 1_800_000_000_000 },
          },
        },
      },
      catalog,
      provider: bedrock,
      enabled: true,
    });

    expect(patch.piProviders).toEqual({
      [openrouter]: {
        enabled: true,
        apiKey: { value: "", valueRedacted: true },
      },
      [anthropic]: {
        enabled: true,
        oauth: { connected: true, expiresAt: 1_800_000_000_000 },
      },
      [bedrock]: {
        enabled: true,
      },
    });
  });

  it("sets a new api key only when the user typed a replacement", () => {
    const patch = buildPiProviderApiKeyPatch({
      settings: {
        piProviders: {
          [openrouter]: {
            enabled: true,
            apiKey: { value: "", valueRedacted: true },
          },
          [anthropic]: {
            enabled: true,
            oauth: { connected: true },
          },
        },
      },
      catalog,
      provider: openrouter,
      value: " sk-new ",
    });

    expect(patch.piProviders[openrouter]?.apiKey).toEqual({
      value: "sk-new",
      valueRedacted: false,
    });
    expect(patch.piProviders[anthropic]?.oauth).toEqual({ connected: true });
  });

  it("keeps a redacted api key when the submitted input is blank", () => {
    const patch = buildPiProviderApiKeyPatch({
      settings: {
        piProviders: {
          [openrouter]: {
            enabled: true,
            apiKey: { value: "", valueRedacted: true },
          },
        },
      },
      catalog,
      provider: openrouter,
      value: "",
    });

    expect(patch.piProviders[openrouter]?.apiKey).toEqual({
      value: "",
      valueRedacted: true,
    });
  });

  it("disconnects oauth by removing the oauth block without dropping the provider entry", () => {
    const patch = buildPiProviderOAuthDisconnectedPatch({
      settings: {
        piProviders: {
          [anthropic]: {
            enabled: true,
            oauth: { connected: true, expiresAt: 1_800_000_000_000 },
          },
          [openrouter]: {
            enabled: false,
            apiKey: { value: "", valueRedacted: true },
          },
        },
      },
      catalog,
      provider: anthropic,
    });

    expect(patch.piProviders[anthropic]).toEqual({ enabled: true });
    expect(patch.piProviders[openrouter]?.apiKey).toEqual({ value: "", valueRedacted: true });
  });

  it("round-trips redacted catalog/settings state without clobbering secrets", () => {
    const piProviders = buildPiProvidersWholeMap({
      settings: {
        piProviders: {
          [openrouter]: {
            enabled: true,
            apiKey: { value: "", valueRedacted: true },
          },
        },
      },
      catalog,
    });

    expect(piProviders[openrouter]?.apiKey).toEqual({ value: "", valueRedacted: true });
    expect(piProviders[anthropic]).toEqual({ enabled: true });
    expect(piProviders[bedrock]).toEqual({ enabled: false });
  });
});
