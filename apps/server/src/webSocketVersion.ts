export const WEBSOCKET_CLIENT_VERSION_QUERY_PARAM = "clientVersion";

export type WebSocketVersionCheck =
  | { readonly compatible: true }
  | {
      readonly compatible: false;
      readonly clientVersion: string | null;
      readonly serverVersion: string;
      readonly message: string;
    };

export function checkWebSocketClientVersion(
  requestUrl: URL | null,
  serverVersion: string,
): WebSocketVersionCheck {
  const clientVersion = requestUrl?.searchParams.get(WEBSOCKET_CLIENT_VERSION_QUERY_PARAM)?.trim();
  if (clientVersion === serverVersion) {
    return { compatible: true };
  }

  const normalizedClientVersion = clientVersion && clientVersion.length > 0 ? clientVersion : null;
  return {
    compatible: false,
    clientVersion: normalizedClientVersion,
    serverVersion,
    message: normalizedClientVersion
      ? `GedCode client ${normalizedClientVersion} cannot connect to server ${serverVersion}. Update or reload GedCode so both versions match exactly.`
      : `This GedCode client did not provide a version and cannot connect to server ${serverVersion}. Update or reload GedCode.`,
  };
}
