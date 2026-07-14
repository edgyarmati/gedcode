import * as Effect from "effect/Effect";
import { z } from "zod/v4";

import { makePmToolExecutors, type PmToolExecutor } from "../pm/pmTools.ts";

export const ORCHESTRATION_MCP_SERVER_NAME = "t3_orchestrator";

export const ORCHESTRATION_MCP_TOOL_NAMES = [
  "classifyRequest",
  "createTask",
  "splitTask",
  "handoffWorker",
  "steerStage",
  "interruptStage",
  "requestApproval",
  "setTaskBackend",
  "inspectStage",
  "cancelTask",
  "landTask",
  "archiveTask",
  "restoreTask",
  "deleteTask",
  "getTaskLedger",
] as const;

export type OrchestrationMcpToolName = (typeof ORCHESTRATION_MCP_TOOL_NAMES)[number];

const stageRole = z.enum(["classify", "plan", "review", "work", "verify"]);

export const mcpInputSchemas = {
  classifyRequest: {
    taskId: z.string(),
    taskType: z.string().optional(),
    playbookVersion: z.string().optional(),
  },
  createTask: {
    projectId: z.string(),
    title: z.string(),
    idempotencyKey: z.string().trim().min(1),
    taskType: z.string().optional(),
    branch: z.string().optional(),
    supersedesTaskId: z.string().optional(),
    releaseSourceTaskId: z.string().optional(),
  },
  splitTask: {
    parentTaskId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1),
    children: z
      .array(
        z.object({
          key: z.string().trim().min(1),
          title: z.string().trim().min(1),
          taskType: z.string().trim().min(1).optional(),
          acceptanceCriteria: z.array(z.string().trim().min(1)).min(1).max(12),
          dependsOnKeys: z.array(z.string().trim().min(1)).optional(),
        }),
      )
      .min(2)
      .max(8),
  },
  handoffWorker: {
    taskId: z.string(),
    role: stageRole,
    instructions: z.string(),
  },
  steerStage: {
    taskId: z.string(),
    message: z.string(),
    stageThreadId: z.string().optional(),
  },
  interruptStage: {
    taskId: z.string(),
    stageThreadId: z.string().optional(),
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
    options: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          value: z.union([z.string().trim().min(1), z.boolean()]),
        }),
      )
      .optional(),
  },
  inspectStage: {
    taskId: z.string(),
    stageThreadId: z.string().optional(),
  },
  cancelTask: {
    taskId: z.string(),
  },
  landTask: {
    taskId: z.string(),
  },
  archiveTask: {
    taskId: z.string(),
  },
  restoreTask: {
    taskId: z.string(),
  },
  deleteTask: {
    taskId: z.string(),
  },
  getTaskLedger: {
    projectId: z.string(),
  },
} as const;

export const ORCHESTRATION_MCP_INSTRUCTIONS =
  "Use these tools to manage the T3 Code orchestration ledger, worker handoffs, approvals, and task state. Do not use them for filesystem or shell access.";

export const orchestrationMcpToolId = (toolName: OrchestrationMcpToolName): string =>
  `mcp__${ORCHESTRATION_MCP_SERVER_NAME}__${toolName}`;

export const orchestrationMcpToolIds = (): ReadonlyArray<string> =>
  ORCHESTRATION_MCP_TOOL_NAMES.map(orchestrationMcpToolId);

export const isOrchestrationMcpToolId = (toolName: string): boolean =>
  orchestrationMcpToolIds().includes(toolName);

export function orderOrchestrationMcpExecutors(
  executors: ReadonlyArray<PmToolExecutor<any, unknown>>,
): ReadonlyArray<PmToolExecutor<any, unknown>> {
  const byName = new Map(executors.map((executor) => [executor.name, executor]));
  return ORCHESTRATION_MCP_TOOL_NAMES.map((name) => {
    const executor = byName.get(name);
    if (!executor) {
      throw new Error(`Missing orchestration MCP executor '${name}'.`);
    }
    return executor as PmToolExecutor<any, unknown>;
  });
}

export const makeOrchestrationMcpExecutors = Effect.gen(function* () {
  const executors = yield* makePmToolExecutors;
  return orderOrchestrationMcpExecutors(executors);
});
