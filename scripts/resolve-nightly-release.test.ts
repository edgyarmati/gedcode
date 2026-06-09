import { assert, it } from "@effect/vitest";

import {
  resolveNightlyBaseVersion,
  resolveNightlyReleaseMetadata,
  resolveNightlyTargetVersion,
} from "./resolve-nightly-release.ts";

it("strips prerelease and build metadata when deriving the nightly base version", () => {
  assert.equal(resolveNightlyBaseVersion("0.0.17"), "0.0.17");
  assert.equal(resolveNightlyBaseVersion("9.9.9-smoke.0"), "9.9.9");
  assert.equal(resolveNightlyBaseVersion("1.2.3-beta.4+build.9"), "1.2.3");
});

it("bumps the minor version before deriving nightly prerelease versions", () => {
  assert.equal(resolveNightlyTargetVersion("0.0.17"), "0.1.0");
  assert.equal(resolveNightlyTargetVersion("9.9.9-smoke.0"), "9.10.0");
  assert.equal(resolveNightlyTargetVersion("1.2.3-beta.4+build.9"), "1.3.0");
});

it("derives nightly metadata including the short commit sha in the release name", () => {
  assert.deepStrictEqual(
    resolveNightlyReleaseMetadata("9.10.0", "20260413", 321, "abcdef1234567890"),
    {
      baseVersion: "9.10.0",
      version: "9.10.0-nightly.20260413.321",
      tag: "v9.10.0-nightly.20260413.321",
      name: "GedCode Nightly 9.10.0-nightly.20260413.321 (abcdef123456)",
      shortSha: "abcdef123456",
    },
  );
});
