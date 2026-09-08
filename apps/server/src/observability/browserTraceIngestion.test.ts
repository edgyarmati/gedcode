import { expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";

import { BrowserTraceCollector } from "./Services/BrowserTraceCollector.ts";
import { recordBrowserTracePayload } from "./browserTraceIngestion.ts";

it("does not include rejected browser trace payloads in logs", async () => {
  const renderedLogs: string[] = [];
  const logger = Logger.make(({ message }) => {
    renderedLogs.push(JSON.stringify(message));
  });
  const record = vi.fn(() => Effect.void);
  const secret = "trace-payload-secret-that-must-not-be-logged";

  await Effect.runPromise(
    recordBrowserTracePayload({ resourceSpans: secret }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(BrowserTraceCollector, { record }),
          Logger.layer([logger], { mergeWithExisting: false }),
        ),
      ),
    ),
  );

  expect(record).not.toHaveBeenCalled();
  expect(renderedLogs.join("\n")).toContain("Failed to decode browser OTLP traces");
  expect(renderedLogs.join("\n")).not.toContain(secret);
});
