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
  "setTaskTier",
  "inspectStage",
  "startHelperRun",
  "inspectHelperRun",
  "interruptHelperRun",
  "inspectDirectChanges",
  "commitDirectChanges",
  "inspectTaskChanges",
  "commitTaskChanges",
  "discardTaskChanges",
  "returnTaskChanges",
  "completeTaskWithoutChanges",
  "listPendingStageApprovals",
  "respondToStageApproval",
  "cancelTask",
  "landTask",
  "requestReleaseApproval",
  "dispatchRelease",
  "archiveTask",
  "restoreTask",
  "deleteTask",
  "getTaskLedger",
] as const;

export type OrchestrationMcpToolName = (typeof ORCHESTRATION_MCP_TOOL_NAMES)[number];

const stageRole = z.enum(["plan", "work", "verify"]);
const capabilityTier = z.enum(["cheap", "smart", "genius"]);

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
    tier: capabilityTier,
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
    gate: z.enum(["plan", "land", "release"]),
    contentHash: z.string(),
    stageThreadId: z.string().optional(),
  },
  setTaskTier: {
    taskId: z.string(),
    role: stageRole,
    tier: capabilityTier,
  },
  inspectStage: {
    taskId: z.string(),
    stageThreadId: z.string().optional(),
  },
  startHelperRun: {
    projectId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    tier: capabilityTier.optional(),
    taskId: z.string().trim().min(1).optional(),
  },
  inspectHelperRun: {
    projectId: z.string().trim().min(1),
    helperRunId: z.string().trim().min(1),
  },
  interruptHelperRun: {
    projectId: z.string().trim().min(1),
    helperRunId: z.string().trim().min(1),
  },
  inspectDirectChanges: {
    projectId: z.string().trim().min(1),
  },
  commitDirectChanges: {
    projectId: z.string().trim().min(1),
    patch: z.string().min(1),
    message: z.string().trim().min(12),
    rationale: z.string().trim().min(20),
    checks: z
      .array(
        z.object({
          command: z.string().trim().min(1),
          outcome: z.string().trim().min(1),
        }),
      )
      .min(1)
      .max(8),
  },
  inspectTaskChanges: {
    taskId: z.string().trim().min(1),
  },
  commitTaskChanges: {
    taskId: z.string().trim().min(1),
    paths: z.array(z.string().trim().min(1)).min(1).optional(),
    patch: z.string().min(1).optional(),
    message: z.string().trim().min(12),
  },
  discardTaskChanges: {
    taskId: z.string().trim().min(1),
    paths: z.array(z.string().trim().min(1)).min(1),
  },
  returnTaskChanges: {
    taskId: z.string().trim().min(1),
    instructions: z.string().trim().min(1),
    tier: capabilityTier.optional(),
  },
  completeTaskWithoutChanges: {
    taskId: z.string().trim().min(1),
  },
  listPendingStageApprovals: {
    taskId: z.string(),
  },
  respondToStageApproval: {
    taskId: z.string(),
    requestId: z.string(),
    decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
  },
  cancelTask: {
    taskId: z.string(),
  },
  landTask: {
    taskId: z.string(),
  },
  requestReleaseApproval: {
    taskId: z.string(),
    workflow: z.string().trim().min(1),
    ref: z.string().trim().min(1),
    inputs: z.record(z.string(), z.string()).optional(),
  },
  dispatchRelease: {
    taskId: z.string(),
    workflow: z.string().trim().min(1),
    ref: z.string().trim().min(1),
    inputs: z.record(z.string(), z.string()).optional(),
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
  "Use these tools to manage the T3 Code orchestration ledger, worker handoffs, read-only helper runs, approvals, task state, and exact reviewed direct-PM commits. Use provider-native filesystem and shell tools for inspection, editing, and checks.";

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
