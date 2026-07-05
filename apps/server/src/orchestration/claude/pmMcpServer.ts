import { randomUUID } from "node:crypto";

import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";

import type { PmToolExecutor } from "../pm/pmTools.ts";
export {
  ORCHESTRATION_MCP_SERVER_NAME,
  ORCHESTRATION_MCP_TOOL_NAMES,
  isOrchestrationMcpToolId,
  orchestrationMcpToolId,
  orchestrationMcpToolIds,
  type OrchestrationMcpToolName,
} from "../mcp/orchestrationMcpTools.ts";
import {
  ORCHESTRATION_MCP_INSTRUCTIONS,
  ORCHESTRATION_MCP_SERVER_NAME,
  ORCHESTRATION_MCP_TOOL_NAMES,
  mcpInputSchemas,
  makeOrchestrationMcpExecutors,
  type OrchestrationMcpToolName,
} from "../mcp/orchestrationMcpTools.ts";

export const makeOrchestrationMcpToolDefinitions = Effect.gen(function* () {
  const executors = yield* makeOrchestrationMcpExecutors;

  return ORCHESTRATION_MCP_TOOL_NAMES.map((name, index) => {
    const executor = executors[index]!;
    return makeMcpToolDefinition(
      name,
      executor as PmToolExecutor<any, unknown>,
      mcpInputSchemas[name],
    );
  });
});

export const makeOrchestrationMcpServer = makeOrchestrationMcpToolDefinitions.pipe(
  Effect.map(
    (tools): McpServerConfig =>
      createSdkMcpServer({
        name: ORCHESTRATION_MCP_SERVER_NAME,
        version: "1.0.0",
        instructions: ORCHESTRATION_MCP_INSTRUCTIONS,
        tools: tools as Array<SdkMcpToolDefinition<any>>,
        alwaysLoad: true,
      }),
  ),
);

function makeMcpToolDefinition(
  name: OrchestrationMcpToolName,
  executor: PmToolExecutor<any, unknown>,
  inputSchema: (typeof mcpInputSchemas)[OrchestrationMcpToolName],
): SdkMcpToolDefinition<any> {
  return tool(
    name,
    executor.description,
    inputSchema,
    async (args) => {
      const result = await executor.execute(`mcp:${name}:${randomUUID()}`, args);
      const structuredContent =
        typeof result.details === "object" && result.details !== null
          ? (result.details as Record<string, unknown>)
          : { value: result.details };
      return {
        content: [...result.content],
        structuredContent,
      };
    },
    {
      alwaysLoad: true,
    },
  );
}
