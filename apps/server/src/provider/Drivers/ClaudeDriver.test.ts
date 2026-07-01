import type {
  McpServerConfig,
  Options as ClaudeQueryOptions,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import {
  ORCHESTRATION_MCP_SERVER_NAME,
  orchestrationMcpToolId,
} from "../../orchestration/claude/pmMcpServer.ts";
import {
  OrchestrationMcpServerProvider,
  OrchestrationMcpServerProviderLive,
} from "../../orchestration/claude/OrchestrationMcpServerProvider.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { ClaudeDriver } from "./ClaudeDriver.ts";

type QueryCreateInput = {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: ClaudeQueryOptions;
};

const sdkMockState = vi.hoisted(
  (): {
    lastCreateInput: unknown;
  } => ({
    lastCreateInput: undefined,
  }),
);

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: (input: QueryCreateInput) => {
      sdkMockState.lastCreateInput = input;
      return {
        async *[Symbol.asyncIterator]() {},
        close: () => undefined,
        interrupt: () => undefined,
        setModel: () => undefined,
        setPermissionMode: () => undefined,
      };
    },
  };
});

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
  ),
);

const TestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "claude-driver-test",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(TestHttpClientLive),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  Layer.provideMerge(OrchestrationMcpServerProviderLive),
);

describe("ClaudeDriver", () => {
  it.effect("lazily reads the registered orchestration MCP server factory at session start", () =>
    Effect.gen(function* () {
      sdkMockState.lastCreateInput = undefined;
      const holder = yield* OrchestrationMcpServerProvider;
      const instanceId = ProviderInstanceId.make("claude-pm");
      const instance = yield* ClaudeDriver.create({
        instanceId,
        displayName: "Claude PM",
        accentColor: undefined,
        environment: [],
        enabled: false,
        config: {
          enabled: false,
          binaryPath: "claude",
          homePath: "",
          customModels: [],
          launchArgs: "",
        },
      });

      const mcpServer = { type: "sdk" } as McpServerConfig;
      yield* holder.register(() => Promise.resolve(mcpServer));

      yield* instance.adapter.startSession({
        threadId: ThreadId.make("pm:project-1"),
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: instanceId,
        runtimeMode: "approval-required",
        readOnly: true,
        enableOrchestrationTools: true,
      });

      const queryInput = sdkMockState.lastCreateInput as QueryCreateInput | undefined;
      assert.notStrictEqual(queryInput, undefined);
      const options = queryInput!.options;
      assert.strictEqual(options.permissionMode, "default");
      assert.strictEqual(options.strictMcpConfig, true);
      assert.ok(options.allowedTools?.includes(orchestrationMcpToolId("createTask")));
      assert.strictEqual(options.mcpServers?.[ORCHESTRATION_MCP_SERVER_NAME], mcpServer);
    }).pipe(Effect.provide(TestLayer)),
  );
});
