import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ElectronSparkleUpdater from "../electron/ElectronSparkleUpdater.ts";
import { makeSparkleTestBridge } from "../electron/sparkleTestBridge.ts";
import { sparkleAppcastUrl } from "../electron/sparkleFeed.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import { flushCallbacks, makeHarness } from "./updatesTestHarness.ts";

/** The end-to-end claim this file exists to prove: with the Sparkle layer in
    place of electron-updater, the unmodified DesktopUpdates state machine runs
    an update from check to install. */
describe("DesktopUpdates on Sparkle", () => {
  /** What electron-builder writes into a packaged app. DesktopUpdates only
      enables itself when an update feed is configured, and the mock update
      server is an electron-updater feed Sparkle could not read, so the packaged
      marker is what makes this exercise the real path. */
  const appUpdateYml = [
    "provider: github",
    "owner: edgyarmati",
    "repo: gedcode",
    "updaterCacheDirName: gedcode-updater",
    "",
  ].join("\n");

  const makeSparkleHarness = () => {
    const sparkle = makeSparkleTestBridge();
    const harness = makeHarness({
      env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
      appUpdateYml,
      updaterLayer: ElectronSparkleUpdater.makeLayer({ loadBridge: sparkle.loadBridge }),
    });
    return { sparkle, harness };
  };

  it.effect("runs check, download, and install through Sparkle", () => {
    const { sparkle, harness } = makeSparkleHarness();

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.equal((yield* updates.getState).status, "idle");

        yield* updates.check("test");
        yield* flushCallbacks;
        assert.deepEqual(sparkle.feedUrls, [sparkleAppcastUrl("latest")]);
        assert.deepEqual(sparkle.calls, ["init", "setAutomaticChecks:false", "checkForUpdates"]);

        sparkle.emit({ type: "checking" });
        sparkle.emit({ type: "update-available", version: "1.2.4", releaseNotes: "- a fix" });
        yield* flushCallbacks;

        const available = yield* updates.getState;
        assert.equal(available.status, "available");
        assert.equal(available.availableVersion, "1.2.4");

        // Sparkle downloads without being asked; the user has not pressed
        // anything yet, so the state must not move.
        sparkle.emit({ type: "download-progress", percent: 40 });
        yield* flushCallbacks;
        assert.equal((yield* updates.getState).status, "available");

        const download = yield* updates.download.pipe(Effect.forkChild);
        yield* flushCallbacks;
        const downloading = yield* updates.getState;
        assert.equal(downloading.status, "downloading");
        assert.equal(downloading.downloadPercent, 40);

        sparkle.emit({ type: "update-downloaded", version: "1.2.4" });
        yield* flushCallbacks;
        const downloaded = yield* Fiber.join(download);
        assert.equal(downloaded.accepted, true);
        assert.equal(downloaded.completed, true);
        assert.equal((yield* updates.getState).status, "downloaded");

        yield* updates.install;
        yield* flushCallbacks;
        assert.equal(sparkle.bridge.installUpdateNow.mock.calls.length, 1);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("surfaces a missing Sparkle addon as a failed check", () => {
    const harness = makeHarness({
      env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
      appUpdateYml,
      updaterLayer: ElectronSparkleUpdater.makeLayer({ loadBridge: () => Promise.resolve(null) }),
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        yield* updates.check("test");
        yield* flushCallbacks;

        const state = yield* updates.getState;
        assert.equal(state.status, "error");
        assert.include(state.message ?? "", "check for updates");
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("switches the appcast when the channel changes", () => {
    const { sparkle, harness } = makeSparkleHarness();

    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        yield* updates.check("test");
        yield* flushCallbacks;
        yield* updates.setChannel("nightly");
        yield* TestClock.adjust(Duration.millis(15_000));
        yield* flushCallbacks;

        assert.deepEqual(sparkle.feedUrls, [
          sparkleAppcastUrl("latest"),
          sparkleAppcastUrl("nightly"),
        ]);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });
});
