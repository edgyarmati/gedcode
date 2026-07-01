import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  ORCHESTRATION_MCP_SERVER_PROVIDER_MISSING_MESSAGE,
  OrchestrationMcpServerProvider,
  OrchestrationMcpServerProviderLive,
} from "./OrchestrationMcpServerProvider.ts";

describe("OrchestrationMcpServerProvider", () => {
  it.effect("resolves a registered MCP server config", () =>
    Effect.gen(function* () {
      const provider = yield* OrchestrationMcpServerProvider;
      const config = { type: "sdk" } as McpServerConfig;

      yield* provider.register(() => Promise.resolve(config));

      assert.strictEqual(yield* provider.build, config);
    }).pipe(Effect.provide(OrchestrationMcpServerProviderLive)),
  );

  it.effect("fails with the ClaudeAdapter-compatible message before registration", () =>
    Effect.gen(function* () {
      const provider = yield* OrchestrationMcpServerProvider;
      const failure = yield* Effect.flip(provider.build);

      assert.strictEqual(failure.message, ORCHESTRATION_MCP_SERVER_PROVIDER_MISSING_MESSAGE);
    }).pipe(Effect.provide(OrchestrationMcpServerProviderLive)),
  );
});
