import { describe, expect, it } from "vitest";

import { bumpStableVersion, resolveReleaseVersion } from "./resolve-release-version.ts";

describe("resolve-release-version", () => {
  it("bumps stable versions by release type", () => {
    expect(bumpStableVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpStableVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpStableVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("builds stable release versions", () => {
    expect(
      resolveReleaseVersion({
        currentVersion: "1.2.3",
        channel: "stable",
        bump: "minor",
      }),
    ).toBe("1.3.0");
  });

  it("builds nightly release versions from the requested bump", () => {
    expect(
      resolveReleaseVersion({
        currentVersion: "1.2.3",
        channel: "nightly",
        bump: "minor",
        date: "20260609",
        runNumber: "7",
      }),
    ).toBe("1.3.0-nightly.20260609.7");
  });
});
