import {
  CommandId,
  EventId,
  TaskId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { OrchestrationCommandReceipt } from "../persistence/Services/OrchestrationCommandReceipts.ts";
import { fingerprintOrchestrationCommand } from "./commandFingerprint.ts";
import { matchesAcceptedStageCompletion } from "./stageCompletionReceipt.ts";
import { stageCompleteCommandId } from "./stageResolution.ts";

const stageThreadId = ThreadId.make("stage");
const awaitedTurnId = TurnId.make("turn");
const command = {
  type: "task.stage.complete",
  commandId: stageCompleteCommandId(stageThreadId, awaitedTurnId),
  taskId: TaskId.make("task"),
  role: "work",
  stageThreadId,
  awaitedTurnId,
  createdAt: "2026-01-01T00:00:00.000Z",
  diffComplete: false,
  worktreeCompletion: { head: "original-head", dirty: true },
  ownershipViolationPaths: ["implementation.ts"],
  verificationFinalizationError: "Original inspection failed",
} satisfies OrchestrationCommand;
const receipt: OrchestrationCommandReceipt = {
  commandId: command.commandId,
  commandFingerprint: fingerprintOrchestrationCommand(command),
  aggregateKind: "task",
  aggregateId: command.taskId,
  acceptedAt: command.createdAt,
  resultSequence: 5,
  status: "accepted",
  error: null,
};
const event = {
  type: "task.stage-completed",
  sequence: 5,
  eventId: EventId.make("completed"),
  aggregateKind: "task",
  aggregateId: command.taskId,
  occurredAt: command.createdAt,
  commandId: command.commandId,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  payload: {
    taskId: command.taskId,
    role: command.role,
    stageThreadId,
    awaitedTurnId,
    diffComplete: command.diffComplete,
    worktreeCompletion: command.worktreeCompletion,
    ownershipViolationPaths: command.ownershipViolationPaths,
    verificationFinalizationError: command.verificationFinalizationError,
    updatedAt: command.createdAt,
  },
} satisfies OrchestrationEvent;

const retry: OrchestrationCommand = {
  ...command,
  diffComplete: true,
  worktreeCompletion: { head: "new-head", dirty: false },
  ownershipViolationPaths: [],
  verificationFinalizationError: undefined,
};

describe("stage completion receipt reconciliation", () => {
  it("uses the first winner's safety evidence without changing the full fingerprint", () => {
    expect(fingerprintOrchestrationCommand(retry)).not.toBe(receipt.commandFingerprint);
    expect(matchesAcceptedStageCompletion(retry, receipt, event)).toBe(true);
    expect(event.payload.worktreeCompletion.dirty).toBe(true);
    expect(event.payload.ownershipViolationPaths).toEqual(["implementation.ts"]);
  });

  it("fails closed for rejected, legacy sentinel, mismatched or corrupt receipts/events", () => {
    expect(matchesAcceptedStageCompletion(retry, { ...receipt, status: "rejected" }, event)).toBe(
      false,
    );
    expect(
      matchesAcceptedStageCompletion(
        retry,
        { ...receipt, commandFingerprint: `sha256:${"0".repeat(64)}` },
        event,
      ),
    ).toBe(false);
    expect(
      matchesAcceptedStageCompletion(
        retry,
        { ...receipt, aggregateId: TaskId.make("other") },
        event,
      ),
    ).toBe(false);
    expect(
      matchesAcceptedStageCompletion(retry, receipt, {
        ...event,
        commandId: CommandId.make("other"),
      }),
    ).toBe(false);
    expect(matchesAcceptedStageCompletion(retry, receipt, { ...event, sequence: 6 })).toBe(false);
    expect(
      matchesAcceptedStageCompletion(retry, receipt, {
        ...event,
        payload: { ...event.payload, worktreeCompletion: { head: "tampered", dirty: false } },
      }),
    ).toBe(false);
  });

  it("does not generalize first-wins to caller-selected command IDs", () => {
    const customCommand = { ...command, commandId: CommandId.make("custom-completion") };
    expect(
      matchesAcceptedStageCompletion(
        { ...retry, commandId: customCommand.commandId },
        {
          ...receipt,
          commandId: customCommand.commandId,
          commandFingerprint: fingerprintOrchestrationCommand(customCommand),
        },
        { ...event, commandId: customCommand.commandId },
      ),
    ).toBe(false);
  });
});
