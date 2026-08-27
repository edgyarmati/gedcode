import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { APP_VERSION } from "./branding";
import {
  appendVersionMismatchHint,
  assertCompatibleEnvironmentDescriptor,
  GedCodeVersionMismatchError,
  resolveServerConfigVersionMismatch,
  resolveVersionMismatch,
} from "./versionSkew";

describe("versionSkew", () => {
  it("does not warn when versions match", () => {
    expect(resolveVersionMismatch(APP_VERSION)).toBeNull();
  });

  it("returns a mismatch when the server version differs from the client", () => {
    expect(resolveVersionMismatch("9.9.9")).toEqual({
      clientVersion: APP_VERSION,
      serverVersion: "9.9.9",
      hint: "Update or reload GedCode so the client and server use the exact same version.",
    });
  });

  it("reads the server version from config descriptors", () => {
    expect(
      resolveServerConfigVersionMismatch({
        environment: {
          environmentId: EnvironmentId.make("environment-1"),
          label: "Remote",
          platform: {
            os: "darwin",
            arch: "arm64",
          },
          serverVersion: "9.9.9",
          capabilities: {
            repositoryIdentity: true,
          },
        },
      }),
    ).toMatchObject({
      serverVersion: "9.9.9",
    });
  });

  it("rejects incompatible environment descriptors before connection bootstrap", () => {
    expect(() =>
      assertCompatibleEnvironmentDescriptor({
        environmentId: EnvironmentId.make("environment-mismatch"),
        label: "Remote",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "9.9.9",
        capabilities: { repositoryIdentity: true },
      }),
    ).toThrow(GedCodeVersionMismatchError);
  });

  it("appends a hint to connection errors when versions differ", () => {
    const mismatch = resolveVersionMismatch("9.9.9");

    expect(appendVersionMismatchHint("Socket closed.", mismatch)).toBe(
      "Socket closed. Hint: Update or reload GedCode so the client and server use the exact same version.",
    );
  });
});
