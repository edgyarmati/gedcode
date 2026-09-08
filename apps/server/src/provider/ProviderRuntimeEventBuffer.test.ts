import {
  EventId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";

import {
  makeProviderRuntimeEventBuffer,
  PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY,
} from "./ProviderRuntimeEventBuffer.ts";

const runtimeEvent = (index: number): ProviderRuntimeEvent => ({
  type: "session.started",
  eventId: EventId.make(`event-${index}`),
  provider: ProviderDriverKind.make("codex"),
  threadId: ThreadId.make("thread-1"),
  createdAt: "2026-08-30T00:00:00.000Z",
  payload: { message: `event ${index}` },
});

it.effect("backpressures at capacity and resumes producers in FIFO order", () =>
  Effect.gen(function* () {
    const buffer = yield* makeProviderRuntimeEventBuffer;
    const accepted = Array.from({ length: PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY }, (_, index) =>
      runtimeEvent(index),
    );

    yield* Queue.offerAll(buffer, accepted);
    const overflow = runtimeEvent(PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY);
    const blockedOffer = yield* Queue.offer(buffer, overflow).pipe(Effect.forkChild);
    yield* Effect.yieldNow;

    assert.isUndefined(blockedOffer.pollUnsafe());
    assert.deepEqual(yield* Queue.take(buffer), accepted[0]);
    yield* Fiber.join(blockedOffer);

    const remaining = yield* Queue.takeAll(buffer);
    assert.deepEqual(Array.from(remaining), [...accepted.slice(1), overflow]);
  }),
);
