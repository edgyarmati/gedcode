import {
  ClientOrchestrationCommand,
  CommandId,
  MessageId,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationThread,
  ProviderInstanceId,
  ThreadId,
  ThreadTurnStartRequestedPayload,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

const decodeClientCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);
const decodeCommand = Schema.decodeUnknownSync(OrchestrationCommand);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);
const decodeTurnStartRequested = Schema.decodeUnknownSync(ThreadTurnStartRequestedPayload);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);

describe("normal-chat durable message queue contracts", () => {
  it("accepts an enqueue command with the message attachments and turn settings captured", () => {
    const decoded = decodeClientCommand({
      type: "thread.queue.enqueue",
      commandId: CommandId.make("command-enqueue-1"),
      threadId: ThreadId.make("thread-1"),
      queueItemId: "queue-item-1",
      message: {
        messageId: MessageId.make("message-1"),
        text: "follow up",
        attachments: [
          {
            type: "image",
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
            dataUrl: "data:image/png;base64,AQID",
          },
        ],
      },
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
      gedWorkflowEnabled: true,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-08-30T12:00:00.000Z",
    });

    expect(decoded.type).toBe("thread.queue.enqueue");
    if (decoded.type !== "thread.queue.enqueue") {
      throw new Error("Expected queue enqueue command");
    }
    expect(decoded.queueItemId).toBe("queue-item-1");
    expect(decoded.message.attachments).toHaveLength(1);
    expect(decoded.modelSelection.options).toEqual([{ id: "reasoningEffort", value: "high" }]);
  });

  it("exposes the authoritative FIFO and queueing preference on a thread snapshot", () => {
    const decoded = decodeThread({
      id: ThreadId.make("thread-1"),
      projectId: "project-1",
      title: "Chat",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
      },
      gedWorkflowEnabled: true,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      pendingPmHandoff: null,
      queuedMessages: [
        {
          id: "queue-item-1",
          messageId: "message-1",
          text: "first",
          attachments: [],
          modelSelection: {
            instanceId: "codex",
            model: "gpt-5.6",
          },
          gedWorkflowEnabled: true,
          runtimeMode: "full-access",
          interactionMode: "default",
          status: "queued",
          attemptCount: 0,
          dispatchCommandId: null,
          error: null,
          createdAt: "2026-08-30T12:00:00.000Z",
          updatedAt: "2026-08-30T12:00:00.000Z",
        },
      ],
      messageQueueEnabled: false,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    });

    expect(decoded).toMatchObject({
      queuedMessages: [{ id: "queue-item-1", status: "queued" }],
      messageQueueEnabled: false,
    });
  });

  it("accepts an edit command for a queued message", () => {
    const decoded = decodeClientCommand({
      type: "thread.queue.edit",
      commandId: "command-edit-1",
      threadId: "thread-1",
      queueItemId: "queue-item-1",
      text: "updated follow up",
      createdAt: "2026-08-30T12:01:00.000Z",
    });

    expect(decoded).toMatchObject({
      type: "thread.queue.edit",
      queueItemId: "queue-item-1",
      text: "updated follow up",
    });
  });

  it("accepts a delete command for a queued message", () => {
    const decoded = decodeClientCommand({
      type: "thread.queue.delete",
      commandId: "command-delete-1",
      threadId: "thread-1",
      queueItemId: "queue-item-1",
      createdAt: "2026-08-30T12:02:00.000Z",
    });

    expect(decoded).toMatchObject({
      type: "thread.queue.delete",
      queueItemId: "queue-item-1",
    });
  });

  it("accepts a server-authoritative queueing preference change", () => {
    const decoded = decodeClientCommand({
      type: "thread.queue.preference.set",
      commandId: "command-preference-1",
      threadId: "thread-1",
      enabled: false,
      createdAt: "2026-08-30T12:03:00.000Z",
    });

    expect(decoded).toMatchObject({
      type: "thread.queue.preference.set",
      enabled: false,
    });
  });

  it("accepts an explicit queued-message steer or retry request", () => {
    const decoded = decodeClientCommand({
      type: "thread.queue.dispatch",
      commandId: "command-dispatch-1",
      threadId: "thread-1",
      queueItemId: "queue-item-1",
      createdAt: "2026-08-30T12:04:00.000Z",
    });

    expect(decoded).toMatchObject({
      type: "thread.queue.dispatch",
      queueItemId: "queue-item-1",
    });
  });

  it("accepts an internal auto-dispatch request pinned to an observed ready snapshot", () => {
    const decoded = decodeCommand({
      type: "thread.queue.auto-dispatch",
      commandId: "queue:auto:queue-item-1:0:ready-at",
      threadId: "thread-1",
      queueItemId: "queue-item-1",
      expectedThreadUpdatedAt: "2026-08-30T12:04:00.000Z",
      createdAt: "2026-08-30T12:04:00.000Z",
    });

    expect(decoded).toMatchObject({
      type: "thread.queue.auto-dispatch",
      expectedThreadUpdatedAt: "2026-08-30T12:04:00.000Z",
    });
  });

  it("accepts correlated queue dispatch success and failure outcomes", () => {
    const outcomes = [
      decodeCommand({
        type: "thread.queue.dispatch.succeed",
        commandId: "command-outcome-success",
        threadId: "thread-1",
        queueItemId: "queue-item-1",
        dispatchCommandId: "command-dispatch-1",
        createdAt: "2026-08-30T12:05:00.000Z",
      }),
      decodeCommand({
        type: "thread.queue.dispatch.fail",
        commandId: "command-outcome-failure",
        threadId: "thread-1",
        queueItemId: "queue-item-1",
        dispatchCommandId: "command-dispatch-1",
        error: "provider unavailable",
        createdAt: "2026-08-30T12:05:00.000Z",
      }),
    ];

    expect(outcomes.map((outcome) => outcome.type)).toEqual([
      "thread.queue.dispatch.succeed",
      "thread.queue.dispatch.fail",
    ]);
  });

  it("round-trips the durable message-queued event", () => {
    const decoded = decodeEvent({
      type: "thread.message-queued",
      eventId: "event-queued-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      occurredAt: "2026-08-30T12:00:00.000Z",
      sequence: 1,
      commandId: "command-enqueue-1",
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: "thread-1",
        queuedMessage: {
          id: "queue-item-1",
          messageId: "message-1",
          text: "follow up",
          attachments: [],
          modelSelection: { instanceId: "codex", model: "gpt-5.6" },
          gedWorkflowEnabled: true,
          runtimeMode: "full-access",
          interactionMode: "default",
          status: "queued",
          attemptCount: 0,
          dispatchCommandId: null,
          error: null,
          createdAt: "2026-08-30T12:00:00.000Z",
          updatedAt: "2026-08-30T12:00:00.000Z",
        },
      },
    });

    expect(decoded.type).toBe("thread.message-queued");
  });

  it("round-trips queue edits, deletion, preference, and correlated dispatch outcomes", () => {
    const eventBase = {
      eventId: "event-queue-lifecycle",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      occurredAt: "2026-08-30T12:05:00.000Z",
      sequence: 2,
      commandId: "command-queue-lifecycle",
      causationEventId: null,
      correlationId: null,
      metadata: {},
    } as const;
    const decoded = [
      decodeEvent({
        ...eventBase,
        type: "thread.queued-message-edited",
        payload: {
          threadId: "thread-1",
          queueItemId: "queue-item-1",
          text: "edited",
          updatedAt: eventBase.occurredAt,
        },
      }),
      decodeEvent({
        ...eventBase,
        type: "thread.queued-message-deleted",
        payload: {
          threadId: "thread-1",
          queueItemId: "queue-item-1",
          updatedAt: eventBase.occurredAt,
        },
      }),
      decodeEvent({
        ...eventBase,
        type: "thread.message-queue-preference-set",
        payload: {
          threadId: "thread-1",
          enabled: false,
          updatedAt: eventBase.occurredAt,
        },
      }),
      ...(["requested", "succeeded"] as const).map((outcome) =>
        decodeEvent({
          ...eventBase,
          type: `thread.queued-message-dispatch-${outcome}`,
          payload: {
            threadId: "thread-1",
            queueItemId: "queue-item-1",
            dispatchCommandId: "command-dispatch-1",
            updatedAt: eventBase.occurredAt,
          },
        }),
      ),
      decodeEvent({
        ...eventBase,
        type: "thread.queued-message-dispatch-failed",
        payload: {
          threadId: "thread-1",
          queueItemId: "queue-item-1",
          dispatchCommandId: "command-dispatch-1",
          error: "provider unavailable",
          updatedAt: eventBase.occurredAt,
        },
      }),
    ];

    expect(decoded.map((event) => event.type)).toEqual([
      "thread.queued-message-edited",
      "thread.queued-message-deleted",
      "thread.message-queue-preference-set",
      "thread.queued-message-dispatch-requested",
      "thread.queued-message-dispatch-succeeded",
      "thread.queued-message-dispatch-failed",
    ]);
  });

  it("correlates a queued-message dispatch through provider turn delivery", () => {
    const decoded = decodeTurnStartRequested({
      threadId: "thread-1",
      messageId: "message-1",
      runtimeMode: "full-access",
      interactionMode: "default",
      queueItemId: "queue-item-1",
      queueDispatchCommandId: "command-dispatch-1",
      createdAt: "2026-08-30T12:05:00.000Z",
    });

    expect(decoded).toMatchObject({
      queueItemId: "queue-item-1",
      queueDispatchCommandId: "command-dispatch-1",
    });
  });
});
