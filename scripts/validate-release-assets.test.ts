// @effect-diagnostics nodeBuiltinImport:off

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateReleaseAssets, type ReleaseChannel } from "./validate-release-assets.ts";

const version = "1.2.3";

function writeManifest(root: string, name: string, assets: ReadonlyArray<string>): void {
  writeFileSync(
    join(root, name),
    [
      `version: ${version}`,
      "files:",
      ...assets.flatMap((asset, index) => [
        `  - url: ${asset}`,
        `    sha512: hash-${index}`,
        `    size: ${100 + index}`,
      ]),
      `path: ${assets[0]}`,
      "sha512: hash-0",
      "releaseDate: '2026-08-27T00:00:00.000Z'",
      "",
    ].join("\n"),
  );
}

function assetsDirectory(channel: ReleaseChannel): string {
  const root = mkdtempSync(join(tmpdir(), "gedcode-assets-"));
  const platformAssets = {
    mac: [`GedCode-${version}-arm64.zip`, `GedCode-${version}-arm64.dmg`],
    linux: [`GedCode-${version}-x86_64.AppImage`],
    win: [`GedCode-${version}-x64.exe`, `GedCode-${version}-x64.exe.blockmap`],
  };
  for (const name of Object.values(platformAssets).flat()) {
    writeFileSync(join(root, name), name);
  }
  const prefix = channel === "stable" ? "latest" : "nightly";
  const manifests = [
    [`${prefix}-linux.yml`, platformAssets.linux],
    [`${prefix}.yml`, platformAssets.win],
  ] as const;
  for (const [name, assets] of manifests) {
    writeManifest(root, name, assets);
    if (channel === "stable") writeManifest(root, name.replace(/^latest/, "nightly"), assets);
  }
  return root;
}

describe("validateReleaseAssets", () => {
  it.each(["stable", "nightly"] as const)(
    "validates complete, channel-specific %s assets",
    (channel) => {
      const root = assetsDirectory(channel);
      try {
        expect(
          validateReleaseAssets({ releaseAssetsDir: root, version, channel }),
        ).not.toHaveLength(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects a missing platform manifest even when every extension exists", () => {
    const root = assetsDirectory("stable");
    try {
      rmSync(join(root, "latest-linux.yml"));
      expect(() =>
        validateReleaseAssets({ releaseAssetsDir: root, version, channel: "stable" }),
      ).toThrow("latest-linux.yml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects legacy macOS updater manifests now that Sparkle owns the macOS feed", () => {
    const root = assetsDirectory("stable");
    try {
      writeManifest(root, "latest-mac.yml", [`GedCode-${version}-arm64.zip`]);
      expect(() =>
        validateReleaseAssets({ releaseAssetsDir: root, version, channel: "stable" }),
      ).toThrow("Unexpected release assets: latest-mac.yml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing Windows blockmap even when the manifest and installer exist", () => {
    const root = assetsDirectory("nightly");
    try {
      rmSync(join(root, `GedCode-${version}-x64.exe.blockmap`));
      expect(() =>
        validateReleaseAssets({ releaseAssetsDir: root, version, channel: "nightly" }),
      ).toThrow("GedCode-1.2.3-x64.exe.blockmap");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects stale or cross-platform files outside the exact channel asset set", () => {
    const root = assetsDirectory("stable");
    try {
      writeFileSync(join(root, `GedCode-${version}-x64.dmg`), "stale Intel artifact");
      expect(() =>
        validateReleaseAssets({ releaseAssetsDir: root, version, channel: "stable" }),
      ).toThrow("Unexpected release assets: GedCode-1.2.3-x64.dmg");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
