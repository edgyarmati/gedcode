import { randomUUID } from "node:crypto";

import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import { z } from "zod/v4";

import { makePmToolExecutors, type PmToolExecutor } from "../pi/pmTools.ts";

export const ORCHESTRATION_MCP_SERVER_NAME = "t3_orchestrator";

export const ORCHESTRATION_MCP_TOOL_NAMES = [
  "classifyRequest",
  "createTask",
  "handoffWorker",
  "requestApproval",
  "setTaskBackend",
  "inspectStage",
  "cancelTask",
  "getTaskLedger",
] as const;

export type OrchestrationMcpToolName = (typeof ORCHESTRATION_MCP_TOOL_NAMES)[number];

const stageRole = z.enum(["classify", "plan", "review", "work", "verify"]);

const mcpInputSchemas = {
  classifyRequest: {
    taskId: z.string(),
    taskType: z.string().optional(),
    playbookVersion: z.string().optional(),
  },
  createTask: {
    projectId: z.string(),
    title: z.string(),
    taskType: z.string().optional(),
    branch: z.string().optional(),
  },
  handoffWorker: {
    taskId: z.string(),
    role: stageRole,
    instructions: z.string(),
  },
  requestApproval: {
    taskId: z.string(),
    gate: z.enum(["plan", "land"]),
    contentHash: z.string(),
    stageThreadId: z.string().optional(),
  },
  setTaskBackend: {
    taskId: z.string(),
    role: stageRole,
    instanceId: z.string(),
    model: z.string(),
  },
  inspectStage: {
    taskId: z.string(),
  },
  cancelTask: {
    taskId: z.string(),
  },
  getTaskLedger: {
    projectId: z.string(),
  },
} as const;

export const orchestrationMcpToolId = (toolName: OrchestrationMcpToolName): string =>
  `mcp__${ORCHESTRATION_MCP_SERVER_NAME}__${toolName}`;

export const orchestrationMcpToolIds = (): ReadonlyArray<string> =>
  ORCHESTRATION_MCP_TOOL_NAMES.map(orchestrationMcpToolId);

export const isOrchestrationMcpToolId = (toolName: string): boolean =>
  orchestrationMcpToolIds().includes(toolName);

export const makeOrchestrationMcpToolDefinitions = Effect.gen(function* () {
  const executors = yield* makePmToolExecutors;
  const byName = new Map(executors.map((executor) => [executor.name, executor]));

  return ORCHESTRATION_MCP_TOOL_NAMES.map((name) => {
    const executor = byName.get(name);
    if (!executor) {
      throw new Error(`Missing orchestration MCP executor '${name}'.`);
    }
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
        instructions:
          "Use these tools to manage the T3 Code orchestration ledger, worker handoffs, approvals, and task state. Do not use them for filesystem or shell access.",
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
        content: result.content,
        structuredContent,
      };
    },
    {
      alwaysLoad: true,
    },
  );
}
