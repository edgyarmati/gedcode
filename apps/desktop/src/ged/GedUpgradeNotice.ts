import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";

const SHOWN_MARKER = "ged-0.5-upgrade-notice-shown";

/**
 * GedCode 0.4 kept its database in `state.sqlite`; 0.5 imports it into `statev2.sqlite` the first
 * time its server starts. Both files existing means the import already ran. The marker covers
 * launches where the local server never starts, so the notice still shows once.
 */
export const isFirstLaunchAfterV04 = Effect.fn("GedUpgradeNotice.isFirstLaunchAfterV04")(function* (
  stateDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hasV04Database = yield* fs.exists(path.join(stateDir, "state.sqlite"));
  const hasV05Database = yield* fs.exists(path.join(stateDir, "statev2.sqlite"));
  const alreadyShown = yield* fs.exists(path.join(stateDir, SHOWN_MARKER));
  return hasV04Database && !hasV05Database && !alreadyShown;
});

export const markNoticeShown = Effect.fn("GedUpgradeNotice.markNoticeShown")(function* (
  stateDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(stateDir, SHOWN_MARKER), "");
});

const NOTICE: Electron.MessageBoxOptions = {
  type: "info",
  buttons: ["OK"],
  message: "GedCode 0.5 replaces the Ged orchestrator",
  detail: [
    "The old Ged orchestrator — PM sessions and task stages — is deprecated and is not part of this version in that form. Planning, implementation and verification now run through the new orchestrator.",
    "Your projects and threads carry over as regular threads.",
    "PM history (PM sessions, tasks, stage history and gates) does not carry over. It is not deleted: it stays in the old database, and reinstalling GedCode 0.4.8 shows it again.",
  ].join("\n\n"),
};

/** Tells someone upgrading from 0.4 what changed, once, after the app is ready. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    // Checked while the app assembles, before the server creates statev2.sqlite.
    const upgrading = yield* isFirstLaunchAfterV04(environment.stateDir).pipe(
      Effect.catch((error) =>
        Effect.logWarning("could not check for a GedCode 0.4 database", { error }).pipe(
          Effect.as(false),
        ),
      ),
    );
    if (!upgrading) return;
    const electronApp = yield* ElectronApp.ElectronApp;
    const dialog = yield* ElectronDialog.ElectronDialog;
    yield* electronApp.whenReady.pipe(
      Effect.andThen(dialog.showMessageBox(NOTICE)),
      Effect.andThen(markNoticeShown(environment.stateDir)),
      Effect.catchCause((cause) =>
        Effect.logWarning("could not show the GedCode 0.5 upgrade notice", { cause }),
      ),
      Effect.forkScoped,
    );
  }),
);
