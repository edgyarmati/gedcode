import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { forkOrchestrationThreadWithServices } from "./threadFork.ts";

const now = "2026-07-16T00:00:00.000Z";
const sourceThreadId = ThreadId.make("source-thread");
const selectedMessageId = MessageId.make("assistant-1");
const targetThreadId = ThreadId.make("target-thread");
const instanceId = ProviderInstanceId.make("provider-instance");
type ForkCommand = Extract<OrchestrationCommand, { type: "thread.fork" }>;

function readModel(input: {
  readonly driver: "codex" | "claudeAgent";
  readonly running?: boolean;
  readonly withSession?: boolean;
}): OrchestrationReadModel {
  return {
    ...createEmptyReadModel(now),
    projects: [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/current",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: sourceThreadId,
        projectId: ProjectId.make("project-1"),
        title: "Source task",
        modelSelection: { instanceId, model: "model-1" },
        gedWorkflowEnabled: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        latestTurn: input.running
          ? {
              turnId: TurnId.make("turn-running"),
              state: "running",
              requestedAt: now,
              startedAt: now,
              completedAt: null,
              assistantMessageId: null,
            }
          : null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        pendingPmHandoff: null,
        messages: [
          {
            id: MessageId.make("user-1"),
            role: "user",
            text: "Original request",
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: selectedMessageId,
            role: "assistant",
            text: "First answer",
            turnId: TurnId.make("turn-1"),
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: MessageId.make("user-2"),
            role: "user",
            text: "Follow up",
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: MessageId.make("assistant-2"),
            role: "assistant",
            text: "Second answer",
            turnId: TurnId.make("turn-2"),
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session:
          input.withSession === false
            ? null
            : {
                threadId: sourceThreadId,
                status: "ready",
                providerName: input.driver,
                providerInstanceId: instanceId,
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: null,
                updatedAt: now,
              },
      },
    ],
  };
}

function harness(input: {
  readonly driver: "codex" | "claudeAgent";
  readonly running?: boolean;
  readonly withSession?: boolean;
}) {
  const model = readModel(input);
  const forkedSession: ProviderSession = {
    provider: ProviderDriverKind.make(input.driver),
    providerInstanceId: instanceId,
    status: "ready",
    runtimeMode: "full-access",
    cwd: "/workspace/current",
    threadId: targetThreadId,
    resumeCursor: { threadId: "provider-fork" },
    createdAt: now,
    updatedAt: now,
  };
  const forkConversation = vi.fn(() => Effect.succeed(forkedSession));
  const rollbackConversation = vi.fn(() => Effect.void);
  const stopSession = vi.fn(() => Effect.void);
  const dispatch = vi.fn((_command: ForkCommand) => Effect.succeed({ sequence: 42 }));
  const ids = [MessageId.make("copy-1"), MessageId.make("copy-2")];

  return {
    model,
    forkConversation,
    rollbackConversation,
    stopSession,
    dispatch,
    run: forkOrchestrationThreadWithServices(
      {
        snapshotQuery: { getCommandReadModel: () => Effect.succeed(model) },
        providerService: {
          getInstanceInfo: () =>
            Effect.succeed({
              instanceId,
              driverKind: ProviderDriverKind.make(input.driver),
              displayName: undefined,
              enabled: true,
              continuationIdentity: {
                driverKind: ProviderDriverKind.make(input.driver),
                continuationKey: `${input.driver}:instance:${instanceId}`,
              },
            }),
          forkConversation,
          rollbackConversation,
          stopSession,
        },
      },
      {
        newThreadId: Effect.succeed(targetThreadId),
        newMessageId: Effect.sync(() => ids.shift()!),
        commandId: Effect.succeed(CommandId.make("fork-command")),
        createdAt: Effect.succeed(now),
        dispatch,
      },
      { sourceThreadId, sourceMessageId: selectedMessageId },
    ),
  };
}

describe("forkOrchestrationThreadWithServices", () => {
  it("forks Codex natively and rolls back only the new provider thread", async () => {
    const test = harness({ driver: "codex" });
    const sourceBefore = structuredClone(test.model.threads[0]);

    await expect(Effect.runPromise(test.run)).resolves.toEqual({
      threadId: targetThreadId,
      strategy: "provider-native",
      filesystem: "current-state",
      sequence: 42,
    });
    expect(test.forkConversation).toHaveBeenCalledOnce();
    expect(test.rollbackConversation).toHaveBeenCalledWith({
      threadId: targetThreadId,
      numTurns: 1,
    });
    expect(test.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.fork",
      sourceThreadId,
      sourceMessageId: selectedMessageId,
      targetThreadId,
      targetMessageIds: [MessageId.make("copy-1"), MessageId.make("copy-2")],
      session: { threadId: targetThreadId },
    });
    expect(test.model.threads[0]).toEqual(sourceBefore);
  });

  it("uses copied visible history when the provider has no native fork", async () => {
    const test = harness({ driver: "claudeAgent" });

    await expect(Effect.runPromise(test.run)).resolves.toMatchObject({
      strategy: "copied-history",
      filesystem: "current-state",
    });
    expect(test.forkConversation).not.toHaveBeenCalled();
    expect(test.rollbackConversation).not.toHaveBeenCalled();
    expect(test.dispatch.mock.calls[0]?.[0]).not.toHaveProperty("session");
  });

  it("rejects a source with an active turn before touching the provider", async () => {
    const test = harness({ driver: "codex", running: true });
    const result = await Effect.runPromise(test.run.pipe(Effect.flip));

    expect(result.reason).toBe("thread-busy");
    expect(test.forkConversation).not.toHaveBeenCalled();
    expect(test.dispatch).not.toHaveBeenCalled();
  });
});

describe("thread.fork command", () => {
  it("atomically copies only the visible prefix and leaves the source unchanged", async () => {
    const model = readModel({ driver: "claudeAgent" });
    const sourceBefore = structuredClone(model.threads[0]);
    const planned = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "thread.fork",
          commandId: CommandId.make("fork-command"),
          sourceThreadId,
          sourceMessageId: selectedMessageId,
          targetThreadId,
          targetMessageIds: [MessageId.make("copy-1"), MessageId.make("copy-2")],
          createdAt: now,
        },
      }).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(Array.isArray(planned)).toBe(true);
    const events = Array.isArray(planned) ? planned : [planned];
    expect(events.map((event) => event.type)).toEqual([
      "thread.created",
      "thread.message-sent",
      "thread.message-sent",
    ]);

    let projected = model;
    for (const [index, event] of events.entries()) {
      projected = await Effect.runPromise(
        projectEvent(projected, { ...event, sequence: index + 1 } as OrchestrationEvent),
      );
    }
    expect(projected.threads.find((thread) => thread.id === sourceThreadId)).toEqual(sourceBefore);
    const target = projected.threads.find((thread) => thread.id === targetThreadId);
    expect(target).toMatchObject({
      branch: "main",
      worktreePath: null,
      session: null,
    });
    expect(target?.messages.map(({ id, role, text }) => ({ id, role, text }))).toEqual([
      { id: MessageId.make("copy-1"), role: "user", text: "Original request" },
      { id: MessageId.make("copy-2"), role: "assistant", text: "First answer" },
    ]);
  });
});
