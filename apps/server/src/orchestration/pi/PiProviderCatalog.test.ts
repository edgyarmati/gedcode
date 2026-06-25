import { DEFAULT_SERVER_SETTINGS, PiProviderId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import {
  getPiProviderKind,
  listPiProviderCatalog,
  listPiProviderModels,
} from "./PiProviderCatalog.ts";

describe("PiProviderCatalog", () => {
  it("classifies pi providers by OAuth, ambient, and API-key credential kind", () => {
    assert.equal(getPiProviderKind("anthropic"), "oauth");
    assert.equal(getPiProviderKind("github-copilot"), "oauth");
    assert.equal(getPiProviderKind("openai-codex"), "oauth");
    assert.equal(getPiProviderKind("amazon-bedrock"), "ambient");
    assert.equal(getPiProviderKind("google-vertex"), "ambient");
    assert.equal(getPiProviderKind("openrouter"), "apiKey");
  });

  it("lists configured/enabled provider catalog entries without secret values", () => {
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const previousAwsProfile = process.env.AWS_PROFILE;
    process.env.OPENROUTER_API_KEY = "sk-env-openrouter";
    process.env.AWS_PROFILE = "default";

    try {
      const result = listPiProviderCatalog({
        ...DEFAULT_SERVER_SETTINGS,
        piProviders: {
          [PiProviderId.make("openrouter")]: {
            enabled: true,
            apiKey: { value: "sk-stored-openrouter", valueRedacted: true },
          },
          [PiProviderId.make("anthropic")]: {
            enabled: false,
            oauth: { connected: true, expiresAt: 123 },
          },
          [PiProviderId.make("amazon-bedrock")]: {
            enabled: true,
          },
        },
      });

      const openrouter = result.providers.find((provider) => provider.id === "openrouter");
      assert.deepInclude(openrouter, {
        id: PiProviderId.make("openrouter"),
        displayName: "OpenRouter",
        kind: "apiKey",
        envKeys: ["OPENROUTER_API_KEY"],
        configured: true,
        enabled: true,
      });

      const anthropic = result.providers.find((provider) => provider.id === "anthropic");
      assert.deepInclude(anthropic, {
        id: PiProviderId.make("anthropic"),
        kind: "oauth",
        configured: true,
        enabled: false,
      });

      const bedrock = result.providers.find((provider) => provider.id === "amazon-bedrock");
      assert.deepInclude(bedrock, {
        id: PiProviderId.make("amazon-bedrock"),
        kind: "ambient",
        configured: true,
        enabled: true,
      });

      assert.notInclude(JSON.stringify(result), "sk-stored-openrouter");
      assert.notInclude(JSON.stringify(result), "sk-env-openrouter");
    } finally {
      if (previousOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      }
      if (previousAwsProfile === undefined) {
        delete process.env.AWS_PROFILE;
      } else {
        process.env.AWS_PROFILE = previousAwsProfile;
      }
    }
  });

  it("lists models for a provider on demand", () => {
    const result = listPiProviderModels("openai");

    assert.isAtLeast(result.models.length, 1);
    assert.isTrue(
      result.models.every(
        (model) =>
          model.id.length > 0 && model.name.length > 0 && typeof model.contextWindow === "number",
      ),
    );
  });
});
