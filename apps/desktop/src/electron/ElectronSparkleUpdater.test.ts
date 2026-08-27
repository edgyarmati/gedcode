import type { SparkleBridge } from "electron-sparkle-updater";
import { it } from "@effect/vitest";
import assert from "node:assert/strict";
import * as Effect from "effect/Effect";

import { ElectronSparkleUpdater, makeLayer } from "./ElectronSparkleUpdater.ts";

function makeBridge() {
  const calls: string[] = [];
  const bridge: SparkleBridge = {
    init: ({ appcastUrl, publicEdKey }) => {
      calls.push(`init:${appcastUrl}:${publicEdKey}`);
      return true;
    },
    setAutomaticChecks: (enabled) => calls.push(`automatic:${String(enabled)}`),
    checkForUpdates: () => calls.push("check"),
    checkForUpdatesInBackgroundAndDownload: () => calls.push("background-download"),
    installUpdateNow: () => calls.push("install"),
    setFeedURL: (url) => {
      calls.push(`feed:${url}`);
      return true;
    },
  };
  return { bridge, calls };
}

it.effect("configures manual install confirmation and delegates update actions", () => {
  const harness = makeBridge();
  return Effect.gen(function* () {
    const updater = yield* ElectronSparkleUpdater;
    assert.equal(
      yield* updater.configure({
        appcastUrl: "https://example.com/appcast.xml",
        publicEdKey: "key",
      }),
      true,
    );
    assert.equal(yield* updater.checkForUpdatesInBackgroundAndDownload, true);
    assert.equal(yield* updater.checkForUpdates, true);
    assert.equal(yield* updater.installUpdateNow, true);
    assert.deepEqual(harness.calls, [
      "init:https://example.com/appcast.xml:key",
      "feed:https://example.com/appcast.xml",
      "automatic:false",
      "background-download",
      "check",
      "install",
    ]);
  }).pipe(Effect.provide(makeLayer({ loadBridge: async () => harness.bridge })));
});

it.effect("reports an unavailable bridge without attempting update actions", () =>
  Effect.gen(function* () {
    const updater = yield* ElectronSparkleUpdater;
    assert.equal(
      yield* updater.configure({
        appcastUrl: "https://example.com/appcast.xml",
        publicEdKey: "key",
      }),
      false,
    );
    assert.equal(yield* updater.checkForUpdatesInBackgroundAndDownload, false);
  }).pipe(Effect.provide(makeLayer({ loadBridge: async () => null }))),
);
