import type { ServerLifecycleStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";

type LifecycleEventInput =
  | Omit<Extract<ServerLifecycleStreamEvent, { type: "welcome" }>, "sequence">
  | Omit<Extract<ServerLifecycleStreamEvent, { type: "ready" }>, "sequence">;

interface SnapshotState {
  readonly sequence: number;
  readonly events: ReadonlyArray<ServerLifecycleStreamEvent>;
}

export interface ServerLifecycleEventsShape {
  readonly publish: (event: LifecycleEventInput) => Effect.Effect<ServerLifecycleStreamEvent>;
  readonly snapshot: Effect.Effect<SnapshotState>;
  readonly stream: Stream.Stream<ServerLifecycleStreamEvent>;
}

export class ServerLifecycleEvents extends Context.Service<
  ServerLifecycleEvents,
  ServerLifecycleEventsShape
>()("gedcode/serverLifecycleEvents") {}

export const ServerLifecycleEventsLive = Layer.effect(
  ServerLifecycleEvents,
  Effect.gen(function* () {
    // This stream is finite by startup design: one initial welcome, at most
    // one auto-bootstrap welcome replacement, and one ready event. Snapshot
    // state retains only the latest event for each of its two event types.
    // Keep the ordered stream lossless; unlike recurring config snapshots it
    // cannot accumulate an unbounded production backlog.
    const pubsub = yield* PubSub.unbounded<ServerLifecycleStreamEvent>();
    const state = yield* Ref.make<SnapshotState>({
      sequence: 0,
      events: [],
    });

    return {
      publish: (event) =>
        Ref.modify(state, (current) => {
          const nextSequence = current.sequence + 1;
          const nextEvent = {
            ...event,
            sequence: nextSequence,
          } satisfies ServerLifecycleStreamEvent;
          const nextEvents =
            nextEvent.type === "welcome"
              ? [nextEvent, ...current.events.filter((entry) => entry.type !== "welcome")]
              : [nextEvent, ...current.events.filter((entry) => entry.type !== "ready")];
          return [nextEvent, { sequence: nextSequence, events: nextEvents }] as const;
        }).pipe(Effect.tap((event) => PubSub.publish(pubsub, event))),
      snapshot: Ref.get(state),
      get stream() {
        return Stream.fromPubSub(pubsub);
      },
    } satisfies ServerLifecycleEventsShape;
  }),
);
