import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type * as Electron from "electron";

import * as DesktopDocumentSecurity from "../window/DesktopDocumentSecurity.ts";
import * as DesktopIpc from "./DesktopIpc.ts";

function makeFakeIpcMain() {
  const invokeListeners = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  const syncListeners = new Map<string, DesktopIpc.DesktopIpcSyncListener>();

  return {
    ipcMain: {
      removeHandler: (channel: string) => invokeListeners.delete(channel),
      handle: (channel: string, listener: DesktopIpc.DesktopIpcHandleListener) => {
        invokeListeners.set(channel, listener);
      },
      removeAllListeners: (channel: string) => syncListeners.delete(channel),
      on: (channel: string, listener: DesktopIpc.DesktopIpcSyncListener) => {
        syncListeners.set(channel, listener);
      },
    } satisfies DesktopIpc.DesktopIpcMain,
    invoke: (channel: string, event: DesktopIpc.DesktopIpcInvokeEvent, raw: unknown) => {
      const listener = invokeListeners.get(channel);
      if (!listener) {
        throw new Error(`No invoke listener registered for ${channel}.`);
      }
      return listener(event, raw);
    },
    sendSync: (channel: string, event: DesktopIpc.DesktopIpcSyncEvent) => {
      const listener = syncListeners.get(channel);
      if (!listener) {
        throw new Error(`No sync listener registered for ${channel}.`);
      }
      listener(event);
      return event.returnValue;
    },
  };
}

function makeTrustedRenderer(documentUrl: string) {
  const mainFrame = { url: documentUrl } as Electron.WebFrameMain;
  const webContents = { mainFrame } as Electron.WebContents;
  return {
    event: { sender: webContents, senderFrame: mainFrame } as DesktopIpc.DesktopIpcInvokeEvent,
    webContents,
  };
}

describe("DesktopIpc", () => {
  it.effect("allows privileged invokes from the trusted main document", () =>
    Effect.gen(function* () {
      const fake = makeFakeIpcMain();
      const security = DesktopDocumentSecurity.make();
      const renderer = makeTrustedRenderer("http://127.0.0.1:3773/settings");
      security.trustRenderer({
        webContents: renderer.webContents,
        documentUrl: "http://127.0.0.1:3773/",
      });
      const ipc = DesktopIpc.make(fake.ipcMain, security);

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handle({
            channel: "desktop.test.invoke",
            handler: (raw) => Effect.succeed(raw),
          });
          return yield* Effect.promise(() =>
            Promise.resolve(fake.invoke("desktop.test.invoke", renderer.event, "accepted")),
          );
        }),
      );

      assert.equal(result, "accepted");
    }),
  );

  it.effect("rejects privileged invokes after the main document leaves its trusted origin", () =>
    Effect.gen(function* () {
      const fake = makeFakeIpcMain();
      const security = DesktopDocumentSecurity.make();
      const renderer = makeTrustedRenderer("https://untrusted.example/settings");
      security.trustRenderer({
        webContents: renderer.webContents,
        documentUrl: "http://127.0.0.1:3773/",
      });
      const ipc = DesktopIpc.make(fake.ipcMain, security);

      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handle({
            channel: "desktop.test.invoke",
            handler: () => Effect.succeed("accepted"),
          });
          return yield* Effect.promise(async () => {
            try {
              await fake.invoke("desktop.test.invoke", renderer.event, null);
              return "accepted" as const;
            } catch {
              return "rejected" as const;
            }
          });
        }),
      );

      assert.equal(outcome, "rejected");
    }),
  );

  it.effect("rejects privileged invokes from a child frame on the trusted origin", () =>
    Effect.gen(function* () {
      const fake = makeFakeIpcMain();
      const security = DesktopDocumentSecurity.make();
      const renderer = makeTrustedRenderer("http://127.0.0.1:3773/settings");
      security.trustRenderer({
        webContents: renderer.webContents,
        documentUrl: "http://127.0.0.1:3773/",
      });
      const childFrame = { url: "http://127.0.0.1:3773/embedded" } as Electron.WebFrameMain;
      const childEvent = {
        sender: renderer.webContents,
        senderFrame: childFrame,
      } as DesktopIpc.DesktopIpcInvokeEvent;
      const ipc = DesktopIpc.make(fake.ipcMain, security);

      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handle({
            channel: "desktop.test.invoke",
            handler: () => Effect.succeed("accepted"),
          });
          return yield* Effect.promise(async () => {
            try {
              await fake.invoke("desktop.test.invoke", childEvent, null);
              return "accepted" as const;
            } catch {
              return "rejected" as const;
            }
          });
        }),
      );

      assert.equal(outcome, "rejected");
    }),
  );

  it.effect("rejects privileged invokes from another webContents on the trusted origin", () =>
    Effect.gen(function* () {
      const fake = makeFakeIpcMain();
      const security = DesktopDocumentSecurity.make();
      const trustedRenderer = makeTrustedRenderer("http://127.0.0.1:3773/settings");
      const otherRenderer = makeTrustedRenderer("http://127.0.0.1:3773/settings");
      security.trustRenderer({
        webContents: trustedRenderer.webContents,
        documentUrl: "http://127.0.0.1:3773/",
      });
      const ipc = DesktopIpc.make(fake.ipcMain, security);

      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handle({
            channel: "desktop.test.invoke",
            handler: () => Effect.succeed("accepted"),
          });
          return yield* Effect.promise(async () => {
            try {
              await fake.invoke("desktop.test.invoke", otherRenderer.event, null);
              return "accepted" as const;
            } catch {
              return "rejected" as const;
            }
          });
        }),
      );

      assert.equal(outcome, "rejected");
    }),
  );

  it.effect("rejects privileged synchronous IPC from an untrusted document origin", () =>
    Effect.gen(function* () {
      const fake = makeFakeIpcMain();
      const security = DesktopDocumentSecurity.make();
      const renderer = makeTrustedRenderer("https://untrusted.example/settings");
      security.trustRenderer({
        webContents: renderer.webContents,
        documentUrl: "http://127.0.0.1:3773/",
      });
      const ipc = DesktopIpc.make(fake.ipcMain, security);
      const syncEvent = {
        ...renderer.event,
        returnValue: undefined,
      } as DesktopIpc.DesktopIpcSyncEvent;

      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handleSync({
            channel: "desktop.test.sync",
            handler: () => Effect.succeed("accepted"),
          });
          return yield* Effect.sync(() => {
            try {
              fake.sendSync("desktop.test.sync", syncEvent);
              return "accepted" as const;
            } catch {
              return "rejected" as const;
            }
          });
        }),
      );

      assert.equal(outcome, "rejected");
    }),
  );
});
