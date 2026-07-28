import type { OrchestratorProjectStreamItem } from "@t3tools/contracts";
import * as Stream from "effect/Stream";

import {
  projectActivityEventForWebSocket,
  projectActivityForWebSocket,
} from "./activityTransportProjection.ts";

function projectProjectStreamItemForWebSocket(
  item: OrchestratorProjectStreamItem,
): OrchestratorProjectStreamItem {
  if (item.kind === "event") {
    const event = projectActivityEventForWebSocket(item.event);
    return event === item.event
      ? item
      : {
          ...item,
          event,
        };
  }

  const pmThread = item.snapshot.pmThread;
  if (pmThread === null) {
    return item;
  }
  const activities = pmThread.activities.map(projectActivityForWebSocket);
  if (activities.every((activity, index) => activity === pmThread.activities[index])) {
    return item;
  }
  return {
    ...item,
    snapshot: {
      ...item.snapshot,
      pmThread: {
        ...pmThread,
        activities,
      },
    },
  };
}

export const projectProjectStreamTransport = <Error, Requirements>(
  stream: Stream.Stream<OrchestratorProjectStreamItem, Error, Requirements>,
): Stream.Stream<OrchestratorProjectStreamItem, Error, Requirements> =>
  stream.pipe(Stream.map(projectProjectStreamItemForWebSocket));
