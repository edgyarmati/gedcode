// @effect-diagnostics nodeBuiltinImport:off
import assert from "node:assert/strict";
import { request } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, it } from "vitest";

import type { PmToolExecutor } from "../pm/pmTools.ts";
import {
  ORCHESTRATION_MCP_BEARER_TOKEN_ENV_VAR,
  makeCodexMcpServerConfig,
  startOrchestrationMcpHttpServer,
} from "./OrchestrationMcpHttpServer.ts";
import { ORCHESTRATION_MCP_TOOL_NAMES } from "./orchestrationMcpTools.ts";

function makeMockExecutors() {
  const calls: Array<{ name: string; toolCallId: string; params: unknown }> = [];
  const executors = ORCHESTRATION_MCP_TOOL_NAMES.map(
    (name): PmToolExecutor<any, unknown> => ({
      name,
      label: name,
      description: `Mock ${name}`,
      execute: async (toolCallId: string, params: unknown) => {
        calls.push({ name, toolCallId, params });
        return {
          content: [{ type: "text", text: `executed ${name}` }],
          details: { name, params },
        };
      },
    }),
  );
  return { executors, calls };
}

function postWithoutBearer(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const requestHandle = request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    requestHandle.on("error", reject);
    requestHandle.end('{"jsonrpc":"2.0","method":"tools/list","id":1}');
  });
}

describe("OrchestrationMcpHttpServer", () => {
  it("marks only the private orchestration MCP tools as approved for headless PM use", () => {
    assert.deepStrictEqual(
      makeCodexMcpServerConfig({
        url: "http://127.0.0.1:4321/mcp/orchestration",
        bearerToken: "secret",
        bearerTokenEnvVar: ORCHESTRATION_MCP_BEARER_TOKEN_ENV_VAR,
      }),
      {
        mcp_servers: {
          t3_orchestrator: {
            url: "http://127.0.0.1:4321/mcp/orchestration",
            bearer_token_env_var: ORCHESTRATION_MCP_BEARER_TOKEN_ENV_VAR,
            default_tools_approval_mode: "approve",
          },
        },
      },
    );
  });

  it("returns 401 without the bearer token", async () => {
    const { executors } = makeMockExecutors();
    const service = await startOrchestrationMcpHttpServer({
      executors,
      bearerToken: "test-token",
    });

    try {
      const status = await postWithoutBearer(service.endpoint.url);
      assert.equal(status, 401);
    } finally {
      await service.close();
    }
  });

  it("lists and executes tools with the bearer token", async () => {
    const { executors, calls } = makeMockExecutors();
    const service = await startOrchestrationMcpHttpServer({
      executors,
      bearerToken: "test-token",
    });
    const client = new Client({ name: "t3-orchestration-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(service.endpoint.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${service.endpoint.bearerToken}`,
        },
      },
    });

    try {
      await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
      const tools = await client.listTools();
      assert.deepStrictEqual(
        tools.tools.map((tool) => tool.name),
        [...ORCHESTRATION_MCP_TOOL_NAMES],
      );

      const landTool = tools.tools.find((tool) => tool.name === "landTask");
      assert.deepStrictEqual(landTool?.inputSchema, {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
        $schema: "http://json-schema.org/draft-07/schema#",
      });
      const createTool = tools.tools.find((tool) => tool.name === "createTask");
      assert.ok(createTool);
      assert.deepStrictEqual((createTool.inputSchema as { required?: unknown }).required, [
        "projectId",
        "title",
        "idempotencyKey",
      ]);

      const ledgerResult = await client.callTool({
        name: "getTaskLedger",
        arguments: { projectId: "project-1" },
      });

      assert.deepStrictEqual(ledgerResult.content, [
        { type: "text", text: "executed getTaskLedger" },
      ]);
      assert.deepStrictEqual(ledgerResult.structuredContent, {
        name: "getTaskLedger",
        params: { projectId: "project-1" },
      });

      const landResult = await client.callTool({
        name: "landTask",
        arguments: { taskId: "task-1" },
      });

      assert.deepStrictEqual(landResult.content, [{ type: "text", text: "executed landTask" }]);
      assert.deepStrictEqual(landResult.structuredContent, {
        name: "landTask",
        params: { taskId: "task-1" },
      });
      const archiveResult = await client.callTool({
        name: "archiveTask",
        arguments: { taskId: "task-1" },
      });
      assert.deepStrictEqual(archiveResult.structuredContent, {
        name: "archiveTask",
        params: { taskId: "task-1" },
      });
      assert.equal(calls.length, 3);
      assert.equal(calls[0]?.name, "getTaskLedger");
      assert.match(calls[0]?.toolCallId ?? "", /^mcp:getTaskLedger:/);
      assert.equal(calls[1]?.name, "landTask");
      assert.match(calls[1]?.toolCallId ?? "", /^mcp:landTask:/);
      assert.equal(calls[2]?.name, "archiveTask");
      assert.match(calls[2]?.toolCallId ?? "", /^mcp:archiveTask:/);
      assert.equal(service.endpoint.bearerTokenEnvVar, ORCHESTRATION_MCP_BEARER_TOKEN_ENV_VAR);
    } finally {
      await client.close();
      await service.close();
    }
  });
});
