import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { PiModelSelection, PiProviderConfig } from "./piProvider.ts";

const decodePiProviderConfig = Schema.decodeUnknownSync(PiProviderConfig);
const encodePiProviderConfig = Schema.encodeSync(PiProviderConfig);
const decodePiModelSelection = Schema.decodeUnknownSync(PiModelSelection);
const encodePiModelSelection = Schema.encodeSync(PiModelSelection);

describe("PiProviderConfig", () => {
  it("round-trips an API-key provider config including redaction status", () => {
    const decoded = decodePiProviderConfig({
      enabled: true,
      apiKey: {
        value: "sk-test",
        valueRedacted: true,
      },
    });

    expect(encodePiProviderConfig(decoded)).toEqual({
      enabled: true,
      apiKey: {
        value: "sk-test",
        valueRedacted: true,
      },
    });
  });

  it("round-trips an OAuth provider config without secret tokens", () => {
    const decoded = decodePiProviderConfig({
      enabled: true,
      oauth: {
        connected: true,
        expiresAt: 1_789_000_000,
      },
    });

    expect(encodePiProviderConfig(decoded)).toEqual({
      enabled: true,
      oauth: {
        connected: true,
        expiresAt: 1_789_000_000,
      },
    });
  });

  it("round-trips an ambient provider config with only picker availability", () => {
    const decoded = decodePiProviderConfig({
      enabled: true,
    });

    expect(encodePiProviderConfig(decoded)).toEqual({
      enabled: true,
    });
  });
});

describe("PiModelSelection", () => {
  it("round-trips a pi provider and model selection", () => {
    const decoded = decodePiModelSelection({
      piProvider: "openai-codex",
      model: "  gpt-5.5  ",
    });

    expect(encodePiModelSelection(decoded)).toEqual({
      piProvider: "openai-codex",
      model: "gpt-5.5",
    });
  });
});
