import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { assert, expect, vi } from "vite-plus/test";

import * as ElectronSparkleUpdater from "./ElectronSparkleUpdater.ts";
import * as ElectronUpdater from "./ElectronUpdater.ts";
import { makeSparkleTestBridge } from "./sparkleTestBridge.ts";
import { SPARKLE_ED_PUBLIC_KEY, sparkleAppcastUrl } from "@t3tools/shared/sparkleUpdate";

interface RecordedEvent {
  readonly name: string;
  readonly payload: unknown;
}

/** Subscribes to every event DesktopUpdates subscribes to, in one place, so a
    test asserts on the stream the real consumer sees. */
const subscribe = (updater: ElectronUpdater.ElectronUpdater["Service"]) =>
  Effect.gen(function* () {
    const events: Array<RecordedEvent> = [];
    for (const name of [
      "checking-for-update",
      "update-available",
      "update-not-available",
      "error",
      "download-progress",
      "update-downloaded",
    ]) {
      yield* updater.on(name, (payload: unknown) => {
        events.push({ name, payload });
      });
    }
    return events;
  });

describe("ElectronSparkleUpdater", () => {
  it("keeps electron-updater untouched off macOS", () => {
    assert.strictEqual(ElectronSparkleUpdater.layerForPlatform("linux"), ElectronUpdater.layer);
    assert.strictEqual(ElectronSparkleUpdater.layerForPlatform("win32"), ElectronUpdater.layer);
    assert.notStrictEqual(ElectronSparkleUpdater.layerForPlatform("darwin"), ElectronUpdater.layer);
  });

  it.effect("loads the bridge on the first check, against the selected channel's appcast", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, calls, feedUrls } = makeSparkleTestBridge();
        const loadBridge = vi.fn(() => Promise.resolve(bridge));
        const updater = ElectronSparkleUpdater.make({ loadBridge });

        yield* updater.setAutoDownload(false);
        yield* updater.setChannel("nightly");
        assert.strictEqual(loadBridge.mock.calls.length, 0);

        yield* updater.checkForUpdates;

        assert.strictEqual(loadBridge.mock.calls.length, 1);
        assert.deepEqual(feedUrls, [sparkleAppcastUrl("nightly")]);
        assert.strictEqual(bridge.init.mock.calls[0]?.[0].publicEdKey, SPARKLE_ED_PUBLIC_KEY);
        assert.deepEqual(calls, ["init", "setAutomaticChecks:false", "checkForUpdates"]);

        // A second check reuses the configured bridge.
        yield* updater.checkForUpdates;
        assert.strictEqual(bridge.init.mock.calls.length, 1);
      }),
    ),
  );

  it.effect("re-points the feed when the channel changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, feedUrls } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });

        yield* updater.setChannel("latest");
        yield* updater.checkForUpdates;
        yield* updater.setChannel("nightly");
        yield* updater.checkForUpdates;

        assert.deepEqual(feedUrls, [sparkleAppcastUrl("latest"), sparkleAppcastUrl("nightly")]);
      }),
    ),
  );

  it.effect("fails loudly when the Sparkle addon is missing", () =>
    Effect.gen(function* () {
      const updater = ElectronSparkleUpdater.make({ loadBridge: () => Promise.resolve(null) });
      const error = yield* updater.checkForUpdates.pipe(Effect.flip);
      expect(error).toBeInstanceOf(ElectronUpdater.ElectronUpdaterCheckForUpdatesError);
      expect(String(error.cause)).toContain("missing from this build");
    }),
  );

  it.effect("fails the check when the bridge refuses to start", () =>
    Effect.gen(function* () {
      const { bridge } = makeSparkleTestBridge();
      bridge.init.mockReturnValue(false);
      const updater = ElectronSparkleUpdater.make({ loadBridge: () => Promise.resolve(bridge) });
      const error = yield* updater.checkForUpdates.pipe(Effect.flip);
      expect(error).toBeInstanceOf(ElectronUpdater.ElectronUpdaterCheckForUpdatesError);
      expect(String(error.cause)).toContain("refused to start");
    }),
  );

  it.effect("translates Sparkle's events into electron-updater's", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, emit } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });
        const events = yield* subscribe(updater);
        yield* updater.checkForUpdates;

        emit({ type: "checking" });
        emit({ type: "update-not-available" });
        emit({ type: "update-available", version: "1.2.3", releaseNotes: "<p>notes</p>" });

        assert.deepEqual(events, [
          { name: "checking-for-update", payload: undefined },
          { name: "update-not-available", payload: undefined },
          { name: "update-available", payload: { version: "1.2.3", releaseNotes: "<p>notes</p>" } },
        ]);
      }),
    ),
  );

  it.effect("reports an update without a version as an error", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, emit } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });
        const events = yield* subscribe(updater);
        yield* updater.checkForUpdates;

        emit({ type: "update-available" });

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0]?.name, "error");
        expect(String(events[0]?.payload)).toContain("without a version");
      }),
    ),
  );

  it.effect("holds Sparkle's unprompted download back until it is asked for", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, emit } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });
        const events = yield* subscribe(updater);
        yield* updater.checkForUpdates;

        emit({ type: "update-available", version: "1.2.3" });
        // Sparkle accepts the update on its own and starts downloading.
        emit({ type: "download-progress", percent: 11 });
        emit({ type: "download-progress", percent: 42 });

        assert.deepEqual(events, [{ name: "update-available", payload: { version: "1.2.3" } }]);

        const download = yield* updater.downloadUpdate.pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        // Asking replays where the download actually is, not zero.
        assert.deepEqual(events.at(-1), { name: "download-progress", payload: { percent: 42 } });

        emit({ type: "download-progress", percent: 73 });
        emit({ type: "update-downloaded", version: "1.2.3" });
        yield* Fiber.join(download);

        assert.deepEqual(events.slice(1), [
          { name: "download-progress", payload: { percent: 42 } },
          { name: "download-progress", payload: { percent: 73 } },
          { name: "update-downloaded", payload: { version: "1.2.3" } },
        ]);
      }),
    ),
  );

  it.effect("completes at once when Sparkle finished before the download was asked for", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, emit } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });
        const events = yield* subscribe(updater);
        yield* updater.checkForUpdates;

        emit({ type: "update-available", version: "1.2.3" });
        emit({ type: "update-downloaded", version: "1.2.3" });
        assert.strictEqual(events.length, 1);

        yield* updater.downloadUpdate;

        assert.deepEqual(events.at(-1), {
          name: "update-downloaded",
          payload: { version: "1.2.3" },
        });
      }),
    ),
  );

  it.effect("passes a staged update from a previous run straight through", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, emit } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });
        const events = yield* subscribe(updater);
        yield* updater.checkForUpdates;

        emit({ type: "update-downloaded", version: "1.2.3" });

        assert.deepEqual(events, [{ name: "update-downloaded", payload: { version: "1.2.3" } }]);
      }),
    ),
  );

  it.effect("installs on quit when the consumer asked for that", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, emit } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });
        yield* subscribe(updater);
        yield* updater.setAutoInstallOnAppQuit(true);
        yield* updater.checkForUpdates;

        emit({ type: "update-downloaded", version: "1.2.3" });

        assert.strictEqual(bridge.installUpdateOnQuit.mock.calls.length, 1);
      }),
    ),
  );

  it.effect("refuses a download when no update is waiting", () =>
    Effect.gen(function* () {
      const { bridge } = makeSparkleTestBridge();
      const updater = ElectronSparkleUpdater.make({ loadBridge: () => Promise.resolve(bridge) });
      const error = yield* updater.downloadUpdate.pipe(Effect.flip);
      expect(error).toBeInstanceOf(ElectronUpdater.ElectronUpdaterDownloadUpdateError);
    }),
  );

  it.effect("fails an in-flight download when Sparkle errors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, emit } = makeSparkleTestBridge();
        const updater = ElectronSparkleUpdater.make({
          loadBridge: () => Promise.resolve(bridge),
        });
        const events = yield* subscribe(updater);
        yield* updater.checkForUpdates;

        emit({ type: "update-available", version: "1.2.3" });
        const download = yield* updater.downloadUpdate.pipe(Effect.flip, Effect.forkScoped);
        yield* Effect.yieldNow;
        emit({ type: "error", message: "the archive could not be verified" });

        const error = yield* Fiber.join(download);
        expect(error).toBeInstanceOf(ElectronUpdater.ElectronUpdaterDownloadUpdateError);
        expect(String(error.cause)).toContain("could not be verified");
        assert.strictEqual(events.at(-1)?.name, "error");
      }),
    ),
  );

  it.effect("installs through Sparkle on quitAndInstall", () =>
    Effect.gen(function* () {
      const { bridge } = makeSparkleTestBridge();
      const updater = ElectronSparkleUpdater.make({ loadBridge: () => Promise.resolve(bridge) });

      yield* updater.quitAndInstall({ isSilent: true, isForceRunAfter: true });

      assert.strictEqual(bridge.installUpdateNow.mock.calls.length, 1);
    }),
  );

  it.effect("scopes event listeners", () =>
    Effect.gen(function* () {
      const { bridge, emit } = makeSparkleTestBridge();
      const updater = ElectronSparkleUpdater.make({ loadBridge: () => Promise.resolve(bridge) });
      const seen: Array<unknown> = [];

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* updater.on("update-not-available", () => {
            seen.push("inside");
          });
          yield* updater.checkForUpdates;
          emit({ type: "update-not-available" });
        }),
      );
      emit({ type: "update-not-available" });

      assert.deepEqual(seen, ["inside"]);
    }),
  );
});
