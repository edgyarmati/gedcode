import * as Stream from "effect/Stream";

interface PendingItem<Item> {
  readonly item: Item;
  readonly coveredSequenceStart: number;
  readonly coveredSequenceEnd: number;
}

interface TransportEventCompactionOptions<Item, Output> {
  readonly sequenceOf: (item: Item) => number | undefined;
  readonly isCompactable: (item: Item) => boolean;
  readonly compact: (previous: Item, next: Item) => Item | undefined;
  readonly withCoveredSequence: (
    item: Item,
    coveredSequenceStart: number,
    coveredSequenceEnd: number,
  ) => Output;
  readonly passthrough: (item: Item) => Output;
}

/**
 * Compacts only consecutive, explicitly mergeable transport items.
 *
 * This operator intentionally lives after durable ordering. It never changes
 * persisted events or their replay cursor; it only annotates the WebSocket
 * representation with the sequence range represented by each output item.
 */
export const compactConsecutiveTransportItems =
  <Item, Output>(options: TransportEventCompactionOptions<Item, Output>) =>
  <Error, Requirements>(
    stream: Stream.Stream<Item, Error, Requirements>,
  ): Stream.Stream<Output, Error, Requirements> =>
    stream.pipe(
      Stream.mapAccum(
        (): PendingItem<Item> | undefined => undefined,
        (pending, item) => {
          const sequence = options.sequenceOf(item);
          if (sequence === undefined) {
            const outputs =
              pending === undefined
                ? [options.passthrough(item)]
                : [
                    options.withCoveredSequence(
                      pending.item,
                      pending.coveredSequenceStart,
                      pending.coveredSequenceEnd,
                    ),
                    options.passthrough(item),
                  ];
            return [undefined, outputs] as const;
          }

          if (!options.isCompactable(item)) {
            const output = options.withCoveredSequence(item, sequence, sequence);
            if (pending === undefined) {
              return [undefined, [output]] as const;
            }
            return [
              undefined,
              [
                options.withCoveredSequence(
                  pending.item,
                  pending.coveredSequenceStart,
                  pending.coveredSequenceEnd,
                ),
                output,
              ],
            ] as const;
          }

          if (pending === undefined) {
            return [
              {
                item,
                coveredSequenceStart: sequence,
                coveredSequenceEnd: sequence,
              },
              [],
            ] as const;
          }

          const compacted = options.compact(pending.item, item);
          if (compacted !== undefined) {
            return [
              {
                item: compacted,
                coveredSequenceStart: pending.coveredSequenceStart,
                coveredSequenceEnd: sequence,
              },
              [],
            ] as const;
          }

          return [
            {
              item,
              coveredSequenceStart: sequence,
              coveredSequenceEnd: sequence,
            },
            [
              options.withCoveredSequence(
                pending.item,
                pending.coveredSequenceStart,
                pending.coveredSequenceEnd,
              ),
            ],
          ] as const;
        },
        {
          onHalt: (pending) =>
            pending === undefined
              ? []
              : [
                  options.withCoveredSequence(
                    pending.item,
                    pending.coveredSequenceStart,
                    pending.coveredSequenceEnd,
                  ),
                ],
        },
      ),
    );
