import { describe, expect, it } from "vitest";

import { resolvePreviousReleaseTag } from "./resolve-previous-release-tag.ts";

describe("resolve-previous-release-tag", () => {
  it("resolves the previous stable tag for stable releases", () => {
    expect(
      resolvePreviousReleaseTag("stable", "v1.2.0", [
        "v1.0.0",
        "v1.1.0",
        "v1.2.0-nightly.20260610.1",
      ]),
    ).toBe("v1.1.0");
  });

  it("resolves the previous nightly tag for nightly releases", () => {
    expect(
      resolvePreviousReleaseTag("nightly", "v1.2.0-nightly.20260610.2", [
        "v1.1.0",
        "v1.2.0-nightly.20260609.7",
        "v1.2.0-nightly.20260610.1",
      ]),
    ).toBe("v1.2.0-nightly.20260610.1");
  });

  it("rejects nightly tags when resolving the stable channel", () => {
    expect(() =>
      resolvePreviousReleaseTag("stable", "v1.2.0-nightly.20260610.1", ["v1.1.0"]),
    ).toThrow("Invalid stable release tag");
  });
});
