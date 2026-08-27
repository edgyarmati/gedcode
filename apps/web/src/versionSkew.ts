import type { ExecutionEnvironmentDescriptor, ServerConfig } from "@t3tools/contracts";

import { APP_VERSION } from "./branding";

export interface VersionMismatch {
  readonly clientVersion: string;
  readonly serverVersion: string;
  readonly hint: string;
}

export class GedCodeVersionMismatchError extends Error {
  readonly mismatch: VersionMismatch;

  constructor(mismatch: VersionMismatch) {
    super(
      `GedCode ${mismatch.clientVersion} cannot connect to server ${mismatch.serverVersion}. ` +
        "Reload after updating GedCode so the client and server versions match exactly.",
    );
    this.name = "GedCodeVersionMismatchError";
    this.mismatch = mismatch;
  }
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveVersionMismatch(
  serverVersion: string | null | undefined,
): VersionMismatch | null {
  const normalizedClientVersion = normalizeVersion(APP_VERSION);
  const normalizedServerVersion = normalizeVersion(serverVersion);
  if (
    !normalizedClientVersion ||
    !normalizedServerVersion ||
    normalizedClientVersion === normalizedServerVersion
  ) {
    return null;
  }

  return {
    clientVersion: normalizedClientVersion,
    serverVersion: normalizedServerVersion,
    hint: "Update or reload GedCode so the client and server use the exact same version.",
  };
}

export function resolveServerConfigVersionMismatch(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): VersionMismatch | null {
  return resolveVersionMismatch(serverConfig?.environment.serverVersion);
}

export function assertCompatibleEnvironmentDescriptor(
  descriptor: ExecutionEnvironmentDescriptor,
): ExecutionEnvironmentDescriptor {
  const mismatch = resolveVersionMismatch(descriptor.serverVersion);
  if (mismatch) {
    throw new GedCodeVersionMismatchError(mismatch);
  }
  return descriptor;
}

export function appendVersionMismatchHint(
  message: string | null | undefined,
  mismatch: VersionMismatch | null | undefined,
): string | null {
  const normalizedMessage = normalizeVersion(message);
  if (!normalizedMessage) {
    return mismatch?.hint ?? null;
  }
  if (!mismatch) {
    return normalizedMessage;
  }
  return `${normalizedMessage} Hint: ${mismatch.hint}`;
}
