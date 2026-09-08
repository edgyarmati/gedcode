import * as Context from "effect/Context";

import type * as Electron from "electron";

export interface TrustedDesktopRenderer {
  readonly webContents: Electron.WebContents;
  readonly documentUrl: string;
}

export interface DesktopIpcSenderEvent {
  readonly sender: Electron.WebContents;
  readonly senderFrame: Electron.WebFrameMain | null;
}

export interface DesktopDocumentSecurityShape {
  readonly trustRenderer: (renderer: TrustedDesktopRenderer) => void;
  readonly isTrustedDocumentUrl: (url: string) => boolean;
  readonly isTrustedIpcEvent: (event: DesktopIpcSenderEvent) => boolean;
}

export class DesktopDocumentSecurity extends Context.Service<
  DesktopDocumentSecurity,
  DesktopDocumentSecurityShape
>()("@t3tools/desktop/window/DesktopDocumentSecurity") {}

function parseOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const make = (): DesktopDocumentSecurityShape => {
  let trustedOrigin: string | null = null;
  let trustedWebContents: Electron.WebContents | null = null;

  return {
    trustRenderer: ({ documentUrl, webContents }) => {
      trustedOrigin = parseOrigin(documentUrl);
      trustedWebContents = webContents;
    },
    isTrustedDocumentUrl: (url) => trustedOrigin !== null && parseOrigin(url) === trustedOrigin,
    isTrustedIpcEvent: (event) => {
      const senderFrame = event.senderFrame;
      return (
        trustedOrigin !== null &&
        event.sender === trustedWebContents &&
        senderFrame !== null &&
        senderFrame === event.sender.mainFrame &&
        parseOrigin(senderFrame.url) === trustedOrigin
      );
    },
  };
};
