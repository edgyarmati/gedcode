import type { SparkleBridgeEvent } from "electron-sparkle-updater";
import { vi } from "vite-plus/test";

import type { ElectronSparkleBridge } from "./ElectronSparkleUpdater.ts";

/** A hand-driven stand-in for the native Sparkle bridge. Shared by the adapter's
    own tests and the DesktopUpdates end-to-end test. */
export function makeSparkleTestBridge() {
  let handler: ((event: SparkleBridgeEvent) => void) | null = null;
  const calls: Array<string> = [];
  const feedUrls: Array<string> = [];

  const bridge = {
    init: vi.fn((options: { appcastUrl: string; publicEdKey?: string }) => {
      calls.push("init");
      feedUrls.push(options.appcastUrl);
      return true;
    }),
    checkForUpdates: vi.fn(() => {
      calls.push("checkForUpdates");
    }),
    installUpdateNow: vi.fn(() => {
      calls.push("installUpdateNow");
    }),
    installUpdateOnQuit: vi.fn(() => {
      calls.push("installUpdateOnQuit");
    }),
    setAutomaticChecks: vi.fn((enabled: boolean) => {
      calls.push(`setAutomaticChecks:${enabled}`);
    }),
    setEventHandler: vi.fn((next: ((event: SparkleBridgeEvent) => void) | null) => {
      handler = next;
    }),
  } satisfies ElectronSparkleBridge;

  return {
    bridge,
    calls,
    feedUrls,
    loadBridge: () => Promise.resolve(bridge),
    emit: (event: SparkleBridgeEvent) => {
      if (handler === null) throw new Error("no Sparkle event handler is registered");
      handler(event);
    },
  };
}
