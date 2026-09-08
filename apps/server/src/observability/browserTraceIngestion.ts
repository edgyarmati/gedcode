import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as Effect from "effect/Effect";
import { cast } from "effect/Function";
import { OtlpTracer } from "effect/unstable/observability";

import { BrowserTraceCollector } from "./Services/BrowserTraceCollector.ts";

export const recordBrowserTracePayload = Effect.fn("browserTraceIngestion.record")(function* (
  payload: unknown,
) {
  const collector = yield* BrowserTraceCollector;

  yield* Effect.try({
    try: () => decodeOtlpTraceRecords(cast<unknown, OtlpTracer.TraceData>(payload)),
    catch: () => "invalid-payload" as const,
  }).pipe(
    Effect.flatMap((records) => collector.record(records)),
    Effect.catch(() =>
      Effect.logWarning("Failed to decode browser OTLP traces", {
        reason: "invalid-payload",
      }),
    ),
  );
});
