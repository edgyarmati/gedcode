import type {
  OrchestrationShellStreamEvent,
  OrchestrationShellStreamItem,
  OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";

type OrderedShellStreamItem =
  | {
      readonly kind: "snapshot";
      readonly snapshot: OrchestrationShellSnapshot;
    }
  | OrchestrationShellStreamEvent;

function projectShellStreamItem(
  previousCoveredEnd: number | undefined,
  item: OrderedShellStreamItem,
): readonly [state: number | undefined, values: ReadonlyArray<OrchestrationShellStreamItem>] {
  if (item.kind === "snapshot") {
    return [item.snapshot.snapshotSequence, [item]];
  }

  const coveredSequenceStart = (previousCoveredEnd ?? item.sequence - 1) + 1;
  return [
    item.sequence,
    [
      {
        ...item,
        coveredSequenceStart,
        coveredSequenceEnd: item.sequence,
      },
    ],
  ];
}

export const projectShellStreamTransport = <Error, Requirements>(
  stream: Stream.Stream<OrderedShellStreamItem, Error, Requirements>,
): Stream.Stream<OrchestrationShellStreamItem, Error, Requirements> =>
  stream.pipe(Stream.mapAccum((): number | undefined => undefined, projectShellStreamItem));
