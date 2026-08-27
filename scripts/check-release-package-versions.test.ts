// @effect-diagnostics nodeBuiltinImport:off

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkReleasePackageVersionConsistency } from "./check-release-package-versions.ts";
import { releasePackageFiles } from "./lib/release-package-files.ts";

function fixture(manifestVersion = "1.2.3", lockVersion = manifestVersion): string {
  const root = mkdtempSync(join(tmpdir(), "gedcode-release-versions-"));
  for (const relativePath of releasePackageFiles) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ name: relativePath, version: manifestVersion })}\n`);
  }
  writeFileSync(
    join(root, "bun.lock"),
    `{
      "lockfileVersion": 1,
      "workspaces": {
        ${releasePackageFiles
          .map(
            (relativePath) =>
              `${JSON.stringify(dirname(relativePath))}: { "version": ${JSON.stringify(lockVersion)}, },`,
          )
          .join("\n")}
      },
    }`,
  );
  return root;
}

describe("checkReleasePackageVersionConsistency", () => {
  it("accepts matching package manifests and lock metadata", () => {
    const root = fixture();
    try {
      expect(checkReleasePackageVersionConsistency(root)).toBe("1.2.3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects stale workspace metadata in bun.lock", () => {
    const root = fixture("1.2.3", "0.1.2");
    try {
      expect(() => checkReleasePackageVersionConsistency(root)).toThrow(
        "bun.lock workspace versions do not match 1.2.3",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects release package manifests that disagree", () => {
    const root = fixture();
    try {
      writeFileSync(
        join(root, releasePackageFiles[1]),
        `${JSON.stringify({ version: "2.0.0" })}\n`,
      );
      expect(() => checkReleasePackageVersionConsistency(root)).toThrow(
        "Release package versions disagree",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
