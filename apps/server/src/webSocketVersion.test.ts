import { describe, expect, it } from "vitest";

import {
  checkWebSocketClientVersion,
  WEBSOCKET_CLIENT_VERSION_QUERY_PARAM,
} from "./webSocketVersion.ts";

describe("checkWebSocketClientVersion", () => {
  it("accepts an exact client/server version match", () => {
    const url = new URL("https://gedcode.example/ws");
    url.searchParams.set(WEBSOCKET_CLIENT_VERSION_QUERY_PARAM, "0.4.4");

    expect(checkWebSocketClientVersion(url, "0.4.4")).toEqual({ compatible: true });
  });

  it("rejects mismatched and legacy unversioned clients", () => {
    expect(
      checkWebSocketClientVersion(
        new URL("https://gedcode.example/ws?clientVersion=0.4.3"),
        "0.4.4",
      ),
    ).toMatchObject({ compatible: false, clientVersion: "0.4.3", serverVersion: "0.4.4" });
    expect(
      checkWebSocketClientVersion(new URL("https://gedcode.example/ws"), "0.4.4"),
    ).toMatchObject({ compatible: false, clientVersion: null, serverVersion: "0.4.4" });
  });
});
