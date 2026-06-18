import { assert, describe, it } from "@effect/vitest";

import { shouldDeferQuitForGracefulShutdown } from "./DesktopLifecycle.ts";

describe("shouldDeferQuitForGracefulShutdown", () => {
  it("defers a user-initiated quit so the backend can shut down gracefully", () => {
    assert.equal(
      shouldDeferQuitForGracefulShutdown({
        quitAlreadyAllowed: false,
        programmaticQuitInProgress: false,
      }),
      true,
    );
  });

  it("does not defer once graceful shutdown has already completed", () => {
    assert.equal(
      shouldDeferQuitForGracefulShutdown({
        quitAlreadyAllowed: true,
        programmaticQuitInProgress: false,
      }),
      false,
    );
  });

  it("does not defer a programmatic quit (e.g. quitAndInstall) that already owns shutdown", () => {
    // Regression: installDownloadedUpdate stops the backend and sets `quitting`
    // before calling autoUpdater.quitAndInstall(). If before-quit calls
    // event.preventDefault() here, electron-updater's quit is cancelled and the
    // update never installs while the backend is left dead.
    assert.equal(
      shouldDeferQuitForGracefulShutdown({
        quitAlreadyAllowed: false,
        programmaticQuitInProgress: true,
      }),
      false,
    );
  });
});
