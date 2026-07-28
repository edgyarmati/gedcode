import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

interface Sequenced {
  readonly sequence: number;
}

interface SnapshotAtSequence {
  readonly snapshotSequence: number;
}

export const ORCHESTRATION_SUBSCRIPTION_REPLAY_LIMIT = 1_000;

/**
 * How many out-of-order events may wait on one missing global sequence before
 * the gap is released.
 *
 * The durable global sequence is not dense: event-compaction migrations delete
 * rows and leave permanent holes. Waiting forever for a hole to be filled would
 * stall the subscription and grow the pending map without bound, so ordering is
 * bounded work rather than an unbounded promise.
 */
export const ORCHESTRATION_SUBSCRIPTION_MAX_PENDING_GAP_EVENTS = 64;

/** How many times bootstrap may re-snapshot before giving up on catching up. */
export const ORCHESTRATION_SUBSCRIPTION_MAX_SNAPSHOT_REFRESH_ATTEMPTS = 4;

interface ReleasedSequenceGap {
  readonly afterSequence: number;
  readonly resumedAtSequence: number;
}

interface OrderedDurableSubscriptionOptions<
  Event extends Sequenced,
  Snapshot extends SnapshotAtSequence,
  SnapshotItem,
  EventItem,
  LiveError,
  LiveRequirements,
  SnapshotError,
  SnapshotRequirements,
  ReplayError,
  ReplayRequirements,
> {
  /**
   * `contiguous` waits for every global sequence. `sparse-increasing` is for a
   * pre-filtered live source whose items are already ordered but may omit
   * global sequences.
   */
  readonly sequenceMode?: "contiguous" | "sparse-increasing";
  readonly live: Stream.Stream<Event, LiveError, LiveRequirements>;
  readonly loadSnapshot: Effect.Effect<Snapshot, SnapshotError, SnapshotRequirements>;
  readonly replayAfter: (
    sequence: number,
    limit: number,
  ) => Stream.Stream<Event, ReplayError, ReplayRequirements>;
  readonly snapshotRefreshExhausted: (
    previousSequence: number,
    refreshedSequence: number,
  ) => SnapshotError;
  readonly projectReplay: (event: Event, snapshot: Snapshot) => EventItem | undefined;
  readonly projectLive: (event: Event, snapshot: Snapshot) => EventItem | undefined;
  readonly toSnapshotItem: (snapshot: Snapshot) => SnapshotItem;
}

/**
 * Produces one ordered durable subscription without a gap between snapshot
 * loading and live delivery.
 *
 * The live source is attached to one scoped queue before snapshot I/O begins.
 * Replay and buffered events advance the same global-sequence cursor even when
 * a surface projector filters them out, and the queue remains the live source
 * after its buffered entries are drained.
 */
export const orderedDurableSubscription = <
  Event extends Sequenced,
  Snapshot extends SnapshotAtSequence,
  SnapshotItem,
  EventItem,
  LiveError,
  LiveRequirements,
  SnapshotError,
  SnapshotRequirements,
  ReplayError,
  ReplayRequirements,
>(
  options: OrderedDurableSubscriptionOptions<
    Event,
    Snapshot,
    SnapshotItem,
    EventItem,
    LiveError,
    LiveRequirements,
    SnapshotError,
    SnapshotRequirements,
    ReplayError,
    ReplayRequirements
  >,
): Stream.Stream<
  SnapshotItem | EventItem,
  LiveError | SnapshotError | ReplayError,
  LiveRequirements | SnapshotRequirements | ReplayRequirements
> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const liveQueue = yield* Queue.unbounded<Event, LiveError | Cause.Done>();
      yield* options.live.pipe(
        Stream.runIntoQueue(liveQueue),
        Effect.forkScoped({ startImmediately: true }),
      );
      let snapshot = yield* options.loadSnapshot;
      let replayed: Array<Event>;
      for (let attempt = 0; ; attempt += 1) {
        replayed = Array.from(
          yield* options
            .replayAfter(snapshot.snapshotSequence, ORCHESTRATION_SUBSCRIPTION_REPLAY_LIMIT + 1)
            .pipe(Stream.take(ORCHESTRATION_SUBSCRIPTION_REPLAY_LIMIT + 1), Stream.runCollect),
        ).toSorted((left, right) => left.sequence - right.sequence);
        if (replayed.length <= ORCHESTRATION_SUBSCRIPTION_REPLAY_LIMIT) {
          break;
        }

        const previousSequence = snapshot.snapshotSequence;
        const refreshedSnapshot = yield* options.loadSnapshot;
        if (
          refreshedSnapshot.snapshotSequence <= previousSequence ||
          attempt + 1 >= ORCHESTRATION_SUBSCRIPTION_MAX_SNAPSHOT_REFRESH_ATTEMPTS
        ) {
          return yield* Effect.fail(
            options.snapshotRefreshExhausted(previousSequence, refreshedSnapshot.snapshotSequence),
          );
        }
        snapshot = refreshedSnapshot;
      }
      const buffered = yield* Effect.gen(function* () {
        const events: Array<Event> = [];
        let next = yield* Queue.poll(liveQueue);
        while (Option.isSome(next)) {
          events.push(next.value);
          next = yield* Queue.poll(liveQueue);
        }
        return events.toSorted((left, right) => left.sequence - right.sequence);
      });

      let lastSeenSequence = snapshot.snapshotSequence;
      const pendingBySequence = new Map<
        number,
        {
          readonly event: Event;
          readonly project: (event: Event, snapshot: Snapshot) => EventItem | undefined;
        }
      >();
      const releasedGaps: Array<ReleasedSequenceGap> = [];

      const takeEntry = (
        entry: { readonly event: Event; readonly project: typeof options.projectLive },
        into: Array<EventItem>,
      ): void => {
        pendingBySequence.delete(entry.event.sequence);
        lastSeenSequence = entry.event.sequence;
        const item = entry.project(entry.event, snapshot);
        if (item !== undefined) {
          into.push(item);
        }
      };

      /** Drains every contiguous successor of the current cursor. */
      const drainContiguous = (into: Array<EventItem>): void => {
        let next = pendingBySequence.get(lastSeenSequence + 1);
        while (next !== undefined) {
          takeEntry(next, into);
          next = pendingBySequence.get(lastSeenSequence + 1);
        }
      };

      /**
       * Releases the lowest pending entry across a missing sequence, recording
       * the hole so it is never a silent skip.
       */
      const releaseLowestPending = (into: Array<EventItem>): void => {
        const lowest = Math.min(...pendingBySequence.keys());
        const entry = pendingBySequence.get(lowest);
        if (entry === undefined) {
          return;
        }
        releasedGaps.push({ afterSequence: lastSeenSequence, resumedAtSequence: lowest });
        takeEntry(entry, into);
        drainContiguous(into);
      };

      const releaseAllPending = (): Array<EventItem> => {
        const released: Array<EventItem> = [];
        while (pendingBySequence.size > 0) {
          releaseLowestPending(released);
        }
        return released;
      };

      const orderAndProject = (
        event: Event,
        project: (event: Event, snapshot: Snapshot) => EventItem | undefined,
      ): Array<EventItem> => {
        if (event.sequence <= lastSeenSequence || pendingBySequence.has(event.sequence)) {
          return [];
        }
        if (options.sequenceMode === "sparse-increasing") {
          lastSeenSequence = event.sequence;
          const item = project(event, snapshot);
          return item === undefined ? [] : [item];
        }
        pendingBySequence.set(event.sequence, { event, project });

        const projected: Array<EventItem> = [];
        drainContiguous(projected);
        while (pendingBySequence.size > ORCHESTRATION_SUBSCRIPTION_MAX_PENDING_GAP_EVENTS) {
          releaseLowestPending(projected);
        }
        return projected;
      };
      const logReleasedGaps = Effect.suspend(() => {
        if (releasedGaps.length === 0) {
          return Effect.void;
        }
        const gaps = releasedGaps.splice(0, releasedGaps.length);
        return Effect.forEach(
          gaps,
          (gap) =>
            Effect.logWarning("orchestration subscription released a durable sequence gap", gap),
          { discard: true },
        );
      });

      const projectStream = (stream: Stream.Stream<Event, LiveError>) =>
        stream.pipe(
          Stream.flatMap((event) => {
            const items = orderAndProject(event, options.projectLive);
            return releasedGaps.length === 0
              ? Stream.fromIterable(items)
              : Stream.concat(
                  Stream.drain(Stream.fromEffect(logReleasedGaps)),
                  Stream.fromIterable(items),
                );
          }),
        );

      const replayItems = replayed.flatMap((event) =>
        orderAndProject(event, options.projectReplay),
      );
      const bufferedItems = buffered.flatMap((event) =>
        orderAndProject(event, options.projectLive),
      );
      // A bounded replay that stayed under the limit is a complete view of the
      // durable range, and the drained buffer is everything published so far.
      // Anything still waiting is therefore blocked on a hole that no later read
      // can fill, so release it instead of stalling bootstrap forever. Released
      // sequences are all above every item emitted above, so order still holds.
      const releasedItems = releaseAllPending();
      yield* logReleasedGaps;

      const bootstrapItems: Array<SnapshotItem | EventItem> = [
        options.toSnapshotItem(snapshot),
        ...replayItems,
        ...bufferedItems,
        ...releasedItems,
      ];

      return Stream.concat(
        Stream.fromIterable(bootstrapItems),
        projectStream(Stream.fromQueue(liveQueue)),
      );
    }),
  );
