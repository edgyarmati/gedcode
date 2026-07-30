import {
  CommandId,
  EventId,
  MessageId,
  OrchestrationCommand,
  OrchestrationEvent as OrchestrationEventSchema,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const decodeCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEventSchema);

function withSequence(
  event: Omit<OrchestrationEvent, "sequence">,
  sequence: number,
): OrchestrationEvent {
  return { ...event, sequence } as OrchestrationEvent;
}

it.layer(NodeServices.layer)("normal-task Inbox lifecycle", (it) => {
  it.effect("settles a normal task and atomically reopens it for the next human turn", () =>
    Effect.gen(function* () {
      const settledAt = "2026-07-30T10:00:00.000Z";
      const reopenedAt = "2026-07-30T10:01:00.000Z";
      const threadId = ThreadId.make("normal-thread");
      const initial = createEmptyReadModel(settledAt);
      const normalThread = yield* projectEvent(initial, {
        sequence: 1,
        eventId: EventId.make("event-normal-thread-created"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.created",
        occurredAt: settledAt,
        commandId: CommandId.make("command-normal-thread-created"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.make("project-1"),
          title: "Normal task",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: settledAt,
          updatedAt: settledAt,
        },
      });

      const settleCommand = yield* decodeCommand({
        type: "thread.inbox.settle",
        commandId: "command-settle-normal-thread",
        threadId: "normal-thread",
        createdAt: settledAt,
      });
      const settleDecision = yield* decideOrchestrationCommand({
        command: settleCommand,
        readModel: normalThread,
      });
      const settleEvent = yield* decodeEvent(settleDecision);
      expect(String(settleEvent.type)).toBe("thread.inbox-settled");

      const settled = yield* projectEvent(normalThread, withSequence(settleEvent, 2));
      expect((settled.threads[0] as { inboxLifecycle?: string } | undefined)?.inboxLifecycle).toBe(
        "settled",
      );

      const startTurnCommand = yield* decodeCommand({
        type: "thread.turn.start",
        commandId: "command-reopen-normal-thread",
        threadId: "normal-thread",
        message: {
          messageId: "message-reopen-normal-thread",
          role: "user",
          text: "Continue this task",
          attachments: [],
        },
        createdAt: reopenedAt,
      });
      const turnDecision = yield* decideOrchestrationCommand({
        command: startTurnCommand,
        readModel: settled,
      });
      const turnEvents = Array.isArray(turnDecision) ? turnDecision : [turnDecision];
      expect(turnEvents.map((event) => String(event.type))).toEqual([
        "thread.inbox-reopened",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);

      let replayed = settled;
      let sequence = settled.snapshotSequence;
      for (const event of turnEvents) {
        sequence += 1;
        replayed = yield* projectEvent(replayed, withSequence(event, sequence));
      }
      expect((replayed.threads[0] as { inboxLifecycle?: string } | undefined)?.inboxLifecycle).toBe(
        "active",
      );
    }),
  );

  it.effect("keeps a future snooze until explicit reopen or one due-deadline wake", () =>
    Effect.gen(function* () {
      const beforeDeadline = "2026-07-30T12:00:00.000Z";
      const wakeAt = "2026-07-30T12:10:00.000Z";
      const threadId = ThreadId.make("normal-thread-snooze");
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(beforeDeadline)));

      const initial = createEmptyReadModel(beforeDeadline);
      const normalThread = yield* projectEvent(initial, {
        sequence: 1,
        eventId: EventId.make("event-normal-thread-snooze-created"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.created",
        occurredAt: beforeDeadline,
        commandId: CommandId.make("command-normal-thread-snooze-created"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.make("project-1"),
          title: "Normal snoozed task",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: beforeDeadline,
          updatedAt: beforeDeadline,
        },
      });

      const snoozeCommand = yield* decodeCommand({
        type: "thread.inbox.snooze",
        commandId: "command-snooze-normal-thread",
        threadId: "normal-thread-snooze",
        wakeAt,
      });
      const snoozeDecision = yield* decideOrchestrationCommand({
        command: snoozeCommand,
        readModel: normalThread,
      });
      const snoozeEvent = yield* decodeEvent(snoozeDecision);
      expect(String(snoozeEvent.type)).toBe("thread.inbox-snoozed");
      const snoozed = yield* projectEvent(normalThread, withSequence(snoozeEvent, 2));
      expect((snoozed.threads[0] as { inboxLifecycle?: string } | undefined)?.inboxLifecycle).toBe(
        "snoozed",
      );
      expect((snoozed.threads[0] as { inboxWakeAt?: string | null } | undefined)?.inboxWakeAt).toBe(
        wakeAt,
      );

      const reopenCommand = yield* decodeCommand({
        type: "thread.inbox.reopen",
        commandId: "command-reopen-snoozed-thread",
        threadId: "normal-thread-snooze",
      });
      const reopenDecision = yield* decideOrchestrationCommand({
        command: reopenCommand,
        readModel: snoozed,
      });
      const reopenEvent = yield* decodeEvent(reopenDecision);
      const explicitlyReopened = yield* projectEvent(snoozed, withSequence(reopenEvent, 3));
      expect(
        (explicitlyReopened.threads[0] as { inboxLifecycle?: string } | undefined)?.inboxLifecycle,
      ).toBe("active");
      expect(
        (explicitlyReopened.threads[0] as { inboxWakeAt?: string | null } | undefined)?.inboxWakeAt,
      ).toBe(null);

      const resnoozeDecision = yield* decideOrchestrationCommand({
        command: snoozeCommand,
        readModel: explicitlyReopened,
      });
      const resnoozeEvent = yield* decodeEvent(resnoozeDecision);
      const resnoozed = yield* projectEvent(explicitlyReopened, withSequence(resnoozeEvent, 4));
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(wakeAt)));

      const wakeDueCommand = yield* decodeCommand({
        type: "thread.inbox.wake-due",
        commandId: "command-wake-due-snoozed-thread",
      });
      const wakeDueDecision = yield* decideOrchestrationCommand({
        command: wakeDueCommand,
        readModel: resnoozed,
      });
      const wakeDueEvents = Array.isArray(wakeDueDecision) ? wakeDueDecision : [wakeDueDecision];
      expect(wakeDueEvents.map((event) => String(event.type))).toEqual(["thread.inbox-reopened"]);

      let woken = resnoozed;
      let sequence = resnoozed.snapshotSequence;
      for (const event of wakeDueEvents) {
        sequence += 1;
        woken = yield* projectEvent(woken, withSequence(event, sequence));
      }
      const secondWakeDecision = yield* decideOrchestrationCommand({
        command: wakeDueCommand,
        readModel: woken,
      });
      expect(Array.isArray(secondWakeDecision) ? secondWakeDecision : [secondWakeDecision]).toEqual(
        [],
      );
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
