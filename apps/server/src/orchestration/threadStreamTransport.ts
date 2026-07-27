import type { OrchestrationEvent, OrchestrationThreadStreamItem } from "@t3tools/contracts";
import * as Stream from "effect/Stream";

import {
  projectActivityEventForWebSocket,
  projectActivityForWebSocket,
} from "./activityTransportProjection.ts";
import { compactConsecutiveTransportItems } from "./transportEventCompaction.ts";

type OrderedThreadStreamItem =
  | Extract<OrchestrationThreadStreamItem, { kind: "snapshot" }>
  | {
      readonly kind: "event";
      readonly event: OrchestrationEvent;
    };

function compactThreadStreamItems(
  previous: OrderedThreadStreamItem,
  next: OrderedThreadStreamItem,
): OrderedThreadStreamItem | undefined {
  if (
    previous.kind !== "event" ||
    next.kind !== "event" ||
    previous.event.type !== "thread.message-sent" ||
    next.event.type !== "thread.message-sent" ||
    previous.event.payload.role !== "assistant" ||
    next.event.payload.role !== "assistant" ||
    !previous.event.payload.streaming ||
    !next.event.payload.streaming ||
    previous.event.payload.threadId !== next.event.payload.threadId ||
    previous.event.payload.messageId !== next.event.payload.messageId
  ) {
    return undefined;
  }

  return {
    kind: "event",
    event: {
      ...next.event,
      payload: {
        ...next.event.payload,
        text: previous.event.payload.text + next.event.payload.text,
        createdAt: previous.event.payload.createdAt,
      },
    },
  };
}

function projectThreadStreamItemForWebSocket(
  item: OrderedThreadStreamItem,
): OrderedThreadStreamItem {
  if (item.kind === "snapshot") {
    const activities = item.snapshot.thread.activities.map(projectActivityForWebSocket);
    if (
      activities.every((activity, index) => activity === item.snapshot.thread.activities[index])
    ) {
      return item;
    }
    return {
      ...item,
      snapshot: {
        ...item.snapshot,
        thread: {
          ...item.snapshot.thread,
          activities,
        },
      },
    };
  }

  const event = projectActivityEventForWebSocket(item.event);
  if (event === item.event) {
    return item;
  }
  return {
    ...item,
    event,
  };
}

export const projectThreadStreamTransport = <Error, Requirements>(
  stream: Stream.Stream<OrderedThreadStreamItem, Error, Requirements>,
): Stream.Stream<OrderedThreadStreamItem, Error, Requirements> =>
  stream.pipe(Stream.map(projectThreadStreamItemForWebSocket));

export const compactThreadStreamTransport = compactConsecutiveTransportItems<
  OrderedThreadStreamItem,
  OrchestrationThreadStreamItem
>({
  sequenceOf: (item) => (item.kind === "event" ? item.event.sequence : undefined),
  isCompactable: (item) =>
    item.kind === "event" &&
    item.event.type === "thread.message-sent" &&
    item.event.payload.role === "assistant" &&
    item.event.payload.streaming,
  compact: compactThreadStreamItems,
  withCoveredSequence: (item, coveredSequenceStart, coveredSequenceEnd) =>
    item.kind === "snapshot"
      ? item
      : {
          ...item,
          coveredSequenceStart,
          coveredSequenceEnd,
        },
  passthrough: (item) =>
    item.kind === "snapshot"
      ? item
      : {
          ...item,
          coveredSequenceStart: item.event.sequence,
          coveredSequenceEnd: item.event.sequence,
        },
});
