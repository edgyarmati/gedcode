import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Queue from "effect/Queue";

/**
 * The adapter boundary is drained continuously by ProviderService. A bounded
 * buffer keeps a slow canonical event logger from making this boundary grow
 * without limit while retaining every event and its FIFO ordering.
 */
export const PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY = 256;

export const makeProviderRuntimeEventBuffer = Queue.bounded<ProviderRuntimeEvent>(
  PROVIDER_RUNTIME_EVENT_BUFFER_CAPACITY,
);
