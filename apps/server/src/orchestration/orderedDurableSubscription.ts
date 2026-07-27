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
  readonly snapshotRefreshDidNotAdvance: (
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
      while (true) {
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
        if (refreshedSnapshot.snapshotSequence <= previousSequence) {
          return yield* Effect.fail(
            options.snapshotRefreshDidNotAdvance(
              previousSequence,
              refreshedSnapshot.snapshotSequence,
            ),
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
        let next = pendingBySequence.get(lastSeenSequence + 1);
        while (next !== undefined) {
          pendingBySequence.delete(next.event.sequence);
          lastSeenSequence = next.event.sequence;
          const item = next.project(next.event, snapshot);
          if (item !== undefined) {
            projected.push(item);
          }
          next = pendingBySequence.get(lastSeenSequence + 1);
        }
        return projected;
      };
      const projectStream = (stream: Stream.Stream<Event, LiveError>) =>
        stream.pipe(
          Stream.flatMap((event) =>
            Stream.fromIterable(orderAndProject(event, options.projectLive)),
          ),
        );

      const replayItems = replayed.flatMap((event) =>
        orderAndProject(event, options.projectReplay),
      );
      const bufferedItems = buffered.flatMap((event) =>
        orderAndProject(event, options.projectLive),
      );

      const bootstrapItems: Array<SnapshotItem | EventItem> = [
        options.toSnapshotItem(snapshot),
        ...replayItems,
        ...bufferedItems,
      ];

      return Stream.concat(
        Stream.fromIterable(bootstrapItems),
        projectStream(Stream.fromQueue(liveQueue)),
      );
    }),
  );
