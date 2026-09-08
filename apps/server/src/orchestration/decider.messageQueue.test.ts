import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  QueuedMessageId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-08-30T12:00:00.000Z";
const threadId = ThreadId.make("thread-queue");

const makeThreadReadModel = () =>
  projectEvent(createEmptyReadModel(now), {
    sequence: 1,
    eventId: EventId.make("event-thread-created"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.created",
    occurredAt: now,
    commandId: CommandId.make("command-thread-created"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId,
      projectId: ProjectId.make("project-queue"),
      title: "Queue",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });

const decideAndProject = Effect.fn(function* (
  readModel: OrchestrationReadModel,
  command: OrchestrationCommand,
) {
  const result = yield* decideOrchestrationCommand({ command, readModel });
  const events = Array.isArray(result) ? result : [result];
  let next = readModel;
  for (const [index, event] of events.entries()) {
    next = yield* projectEvent(next, {
      ...event,
      sequence: readModel.snapshotSequence + index + 1,
    } as OrchestrationEvent);
  }
  return { events, readModel: next };
});

it.layer(NodeServices.layer)("normal-chat durable message queue decider", (it) => {
  it.effect("enqueues a captured message at the FIFO tail", () =>
    Effect.gen(function* () {
      const readModel = yield* makeThreadReadModel();
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queue.enqueue",
          commandId: CommandId.make("command-enqueue-1"),
          threadId,
          queueItemId: QueuedMessageId.make("queue-item-1"),
          message: {
            messageId: MessageId.make("message-1"),
            text: "follow up",
            attachments: [],
          },
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6",
          },
          gedWorkflowEnabled: true,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: now,
        },
        readModel,
      });
      const event = (Array.isArray(result) ? result[0] : result) as Omit<
        OrchestrationEvent,
        "sequence"
      >;
      expect(event.type).toBe("thread.message-queued");

      const projected = yield* projectEvent(readModel, {
        ...event,
        sequence: 2,
      } as OrchestrationEvent);
      expect(projected.threads[0]?.queuedMessages).toEqual([
        expect.objectContaining({
          id: "queue-item-1",
          text: "follow up",
          status: "queued",
          attemptCount: 0,
        }),
      ]);
    }),
  );

  it.effect("edits, deletes, and persists the per-thread queueing preference", () =>
    Effect.gen(function* () {
      let readModel = yield* makeThreadReadModel();
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.enqueue",
        commandId: CommandId.make("command-enqueue-manage"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-manage"),
        message: { messageId: MessageId.make("message-manage"), text: "draft", attachments: [] },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        gedWorkflowEnabled: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now,
      }));
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.edit",
        commandId: CommandId.make("command-edit"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-manage"),
        text: "edited",
        createdAt: "2026-08-30T12:01:00.000Z",
      }));
      expect(readModel.threads[0]?.queuedMessages?.[0]?.text).toBe("edited");

      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.preference.set",
        commandId: CommandId.make("command-preference"),
        threadId,
        enabled: false,
        createdAt: "2026-08-30T12:02:00.000Z",
      }));
      expect(readModel.threads[0]?.messageQueueEnabled).toBe(false);

      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.delete",
        commandId: CommandId.make("command-delete"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-manage"),
        createdAt: "2026-08-30T12:03:00.000Z",
      }));
      expect(readModel.threads[0]?.queuedMessages).toEqual([]);
    }),
  );

  it.effect("explicitly dispatches a queued item as provider steering during an active turn", () =>
    Effect.gen(function* () {
      let readModel = yield* makeThreadReadModel();
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.enqueue",
        commandId: CommandId.make("command-enqueue-dispatch"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-dispatch"),
        message: {
          messageId: MessageId.make("message-dispatch"),
          text: "steer now",
          attachments: [],
        },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        gedWorkflowEnabled: false,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now,
      }));
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.session.set",
        commandId: CommandId.make("command-session-running-for-queue-steer"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-running-for-queue-steer"),
          lastError: null,
          updatedAt: "2026-08-30T12:00:30.000Z",
        },
        createdAt: "2026-08-30T12:00:30.000Z",
      }));
      const dispatched = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch",
        commandId: CommandId.make("command-dispatch"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-dispatch"),
        createdAt: "2026-08-30T12:01:00.000Z",
      });
      expect(dispatched.events.map((event) => event.type)).toEqual([
        "thread.queued-message-dispatch-requested",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(dispatched.readModel.threads[0]?.queuedMessages?.[0]).toMatchObject({
        status: "dispatching",
        attemptCount: 1,
        dispatchCommandId: "command-dispatch",
      });
      expect(dispatched.events[2]?.payload).toMatchObject({
        queueItemId: "queue-dispatch",
        queueDispatchCommandId: "command-dispatch",
        gedWorkflowEnabled: false,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
    }),
  );

  it.effect("automatically dispatches only the stable FIFO head when the thread is idle", () =>
    Effect.gen(function* () {
      let readModel = yield* makeThreadReadModel();
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.enqueue",
        commandId: CommandId.make("command-enqueue-auto"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-auto"),
        message: { messageId: MessageId.make("message-auto"), text: "next", attachments: [] },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        gedWorkflowEnabled: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now,
      }));
      const expectedThreadUpdatedAt = readModel.threads[0]!.updatedAt;
      const dispatched = yield* decideAndProject(readModel, {
        type: "thread.queue.auto-dispatch",
        commandId: CommandId.make("command-auto-dispatch"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-auto"),
        expectedThreadUpdatedAt,
        createdAt: "2026-08-30T12:01:00.000Z",
      });
      expect(dispatched.events.map((event) => event.type)).toEqual([
        "thread.queued-message-dispatch-requested",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
    }),
  );

  it.effect("retains failed entries for retry and removes only a matching successful attempt", () =>
    Effect.gen(function* () {
      let readModel = yield* makeThreadReadModel();
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.enqueue",
        commandId: CommandId.make("command-enqueue-outcome"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-outcome"),
        message: {
          messageId: MessageId.make("message-outcome"),
          text: "retry me",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        gedWorkflowEnabled: false,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        createdAt: now,
      }));
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch",
        commandId: CommandId.make("command-dispatch-first"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-outcome"),
        createdAt: "2026-08-30T12:01:00.000Z",
      }));
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch.fail",
        commandId: CommandId.make("command-fail-outcome"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-outcome"),
        dispatchCommandId: CommandId.make("command-dispatch-first"),
        error: "provider unavailable",
        createdAt: "2026-08-30T12:02:00.000Z",
      }));
      expect(readModel.threads[0]?.queuedMessages?.[0]).toMatchObject({
        status: "failed",
        error: "provider unavailable",
      });
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch",
        commandId: CommandId.make("command-dispatch-retry"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-outcome"),
        createdAt: "2026-08-30T12:03:00.000Z",
      }));
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch.succeed",
        commandId: CommandId.make("command-succeed-outcome"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-outcome"),
        dispatchCommandId: CommandId.make("command-dispatch-retry"),
        createdAt: "2026-08-30T12:04:00.000Z",
      }));
      expect(readModel.threads[0]?.queuedMessages).toEqual([]);
      expect(readModel.threads[0]).toMatchObject({
        modelSelection: { instanceId: "claudeAgent", model: "claude-opus-4-6" },
        gedWorkflowEnabled: false,
        runtimeMode: "approval-required",
        interactionMode: "plan",
      });
    }),
  );

  it.effect("holds queued entries when the user interrupts a turn", () =>
    Effect.gen(function* () {
      let readModel = yield* makeThreadReadModel();
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.enqueue",
        commandId: CommandId.make("command-enqueue-hold"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-hold"),
        message: {
          messageId: MessageId.make("message-hold"),
          text: "do not auto-send",
          attachments: [],
        },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        gedWorkflowEnabled: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now,
      }));
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.turn.interrupt",
        commandId: CommandId.make("command-interrupt-hold"),
        threadId,
        createdAt: "2026-08-30T12:01:00.000Z",
      }));
      expect(readModel.threads[0]?.queuedMessages?.[0]?.status).toBe("held");
      const failure = yield* Effect.flip(
        decideAndProject(readModel, {
          type: "thread.queue.auto-dispatch",
          commandId: CommandId.make("command-auto-held"),
          threadId,
          queueItemId: QueuedMessageId.make("queue-hold"),
          expectedThreadUpdatedAt: readModel.threads[0]!.updatedAt,
          createdAt: "2026-08-30T12:02:00.000Z",
        }),
      );
      expect(failure._tag).toBe("OrchestrationCommandInvariantError");
      const steered = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch",
        commandId: CommandId.make("command-steer-held"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-hold"),
        createdAt: "2026-08-30T12:03:00.000Z",
      });
      expect(steered.readModel.threads[0]?.queuedMessages?.[0]?.status).toBe("dispatching");
    }),
  );

  it.effect("does not automatically skip a failed FIFO head", () =>
    Effect.gen(function* () {
      let readModel = yield* makeThreadReadModel();
      for (const suffix of ["head", "later"] as const) {
        ({ readModel } = yield* decideAndProject(readModel, {
          type: "thread.queue.enqueue",
          commandId: CommandId.make(`command-enqueue-${suffix}`),
          threadId,
          queueItemId: QueuedMessageId.make(`queue-${suffix}`),
          message: {
            messageId: MessageId.make(`message-${suffix}`),
            text: suffix,
            attachments: [],
          },
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
          gedWorkflowEnabled: true,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: now,
        }));
      }
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch",
        commandId: CommandId.make("command-dispatch-head"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-head"),
        createdAt: "2026-08-30T12:01:00.000Z",
      }));
      ({ readModel } = yield* decideAndProject(readModel, {
        type: "thread.queue.dispatch.fail",
        commandId: CommandId.make("command-fail-head"),
        threadId,
        queueItemId: QueuedMessageId.make("queue-head"),
        dispatchCommandId: CommandId.make("command-dispatch-head"),
        error: "failed head",
        createdAt: "2026-08-30T12:02:00.000Z",
      }));
      const failure = yield* Effect.flip(
        decideAndProject(readModel, {
          type: "thread.queue.auto-dispatch",
          commandId: CommandId.make("command-auto-skip"),
          threadId,
          queueItemId: QueuedMessageId.make("queue-later"),
          expectedThreadUpdatedAt: readModel.threads[0]!.updatedAt,
          createdAt: "2026-08-30T12:03:00.000Z",
        }),
      );
      expect(failure._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
