import * as Arr from "effect/Array";
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
 * Compacts consecutive, explicitly mergeable transport items within one chunk.
 *
 * Compaction never spans a chunk boundary. Holding a mergeable item back to wait
 * for a possible successor would delay live delivery indefinitely whenever a
 * stream produces only mergeable items and then goes idle, which is exactly what
 * a streaming assistant turn does between deltas. Bounding compaction to the
 * items already available therefore keeps the volume reduction for bursts while
 * guaranteeing every item leaves as soon as the source has nothing more to add.
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
    stream.pipe(Stream.mapArray((chunk) => compactChunk(options, chunk)));

/**
 * Every input item either produces an output directly or becomes the pending
 * item that the trailing flush emits, so a non-empty chunk always compacts to a
 * non-empty chunk.
 */
function compactChunk<Item, Output>(
  options: TransportEventCompactionOptions<Item, Output>,
  chunk: Arr.NonEmptyReadonlyArray<Item>,
): Arr.NonEmptyReadonlyArray<Output> {
  const outputs: Array<Output> = [];
  let pending: PendingItem<Item> | undefined;

  const flushPending = (): void => {
    if (pending === undefined) {
      return;
    }
    outputs.push(
      options.withCoveredSequence(
        pending.item,
        pending.coveredSequenceStart,
        pending.coveredSequenceEnd,
      ),
    );
    pending = undefined;
  };

  for (const item of chunk) {
    const sequence = options.sequenceOf(item);
    if (sequence === undefined) {
      flushPending();
      outputs.push(options.passthrough(item));
      continue;
    }

    if (!options.isCompactable(item)) {
      flushPending();
      outputs.push(options.withCoveredSequence(item, sequence, sequence));
      continue;
    }

    if (pending !== undefined) {
      const compacted = options.compact(pending.item, item);
      if (compacted !== undefined) {
        pending = {
          item: compacted,
          coveredSequenceStart: pending.coveredSequenceStart,
          coveredSequenceEnd: sequence,
        };
        continue;
      }
      flushPending();
    }

    pending = {
      item,
      coveredSequenceStart: sequence,
      coveredSequenceEnd: sequence,
    };
  }
  flushPending();

  return Arr.isReadonlyArrayNonEmpty(outputs)
    ? outputs
    : // Unreachable for a non-empty chunk; keeps the operator total without
      // inventing a synthetic item.
      [options.passthrough(chunk[0])];
}
