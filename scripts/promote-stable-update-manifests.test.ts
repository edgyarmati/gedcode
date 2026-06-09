// @effect-diagnostics nodeBuiltinImport:off

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { promoteStableUpdateManifestsToNightly } from "./promote-stable-update-manifests.ts";

describe("promoteStableUpdateManifestsToNightly", () => {
  it("copies stable updater manifests into nightly manifest names", () => {
    const root = mkdtempSync(join(tmpdir(), "gedcode-promote-manifests-"));
    try {
      writeFileSync(join(root, "latest.yml"), "stable windows");
      writeFileSync(join(root, "latest-mac.yml"), "stable mac");
      writeFileSync(join(root, "GedCode-1.2.0-arm64.dmg"), "asset");

      const result = promoteStableUpdateManifestsToNightly(root);

      expect(result.copied).toEqual([
        { from: "latest-mac.yml", to: "nightly-mac.yml" },
        { from: "latest.yml", to: "nightly.yml" },
      ]);
      expect(readFileSync(join(root, "nightly.yml"), "utf8")).toBe("stable windows");
      expect(readFileSync(join(root, "nightly-mac.yml"), "utf8")).toBe("stable mac");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when no stable updater manifests are present", () => {
    const root = mkdtempSync(join(tmpdir(), "gedcode-promote-manifests-empty-"));
    try {
      expect(() => promoteStableUpdateManifestsToNightly(root)).toThrow(
        "No latest updater manifests found",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
