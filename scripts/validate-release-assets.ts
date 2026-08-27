#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { parseUpdateManifest } from "./lib/update-manifest.ts";

export type ReleaseChannel = "stable" | "nightly";

const platformAssets = (version: string) => ({
  mac: [`GedCode-${version}-arm64.zip`, `GedCode-${version}-arm64.dmg`],
  linux: [`GedCode-${version}-x64.AppImage`],
  win: [`GedCode-${version}-x64.exe`, `GedCode-${version}-x64.exe.blockmap`],
});

function expectedManifests(channel: ReleaseChannel): ReadonlyArray<{
  readonly name: string;
  readonly assets: ReadonlyArray<string>;
}> {
  const prefix = channel === "stable" ? "latest" : "nightly";
  return [
    { name: `${prefix}-mac.yml`, assets: [`GedCode-VERSION-arm64.zip`] },
    { name: `${prefix}-linux.yml`, assets: platformAssets("VERSION").linux },
    { name: `${prefix}.yml`, assets: [`GedCode-VERSION-x64.exe`] },
  ];
}

export interface ValidateReleaseAssetsOptions {
  readonly releaseAssetsDir: string;
  readonly version: string;
  readonly channel: ReleaseChannel;
}

export function validateReleaseAssets(
  options: ValidateReleaseAssetsOptions,
): ReadonlyArray<string> {
  if (!statSync(options.releaseAssetsDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Release assets directory does not exist: ${options.releaseAssetsDir}`);
  }

  const expectedAssets = platformAssets(options.version);
  const primaryManifests = expectedManifests(options.channel).map((manifest) => ({
    name: manifest.name,
    assets: manifest.assets.map((asset) => asset.replace("VERSION", options.version)),
  }));
  const promotedManifests =
    options.channel === "stable"
      ? primaryManifests.map((manifest) => ({
          ...manifest,
          name: manifest.name.replace(/^latest/, "nightly"),
        }))
      : [];
  const requiredFiles = [
    ...Object.values(expectedAssets).flat(),
    ...primaryManifests.map((manifest) => manifest.name),
    ...promotedManifests.map((manifest) => manifest.name),
  ];
  const actualFiles = readdirSync(options.releaseAssetsDir)
    .filter((name) => statSync(join(options.releaseAssetsDir, name)).isFile())
    .toSorted();
  const missingFiles = requiredFiles.filter(
    (name) => !existsSync(join(options.releaseAssetsDir, name)),
  );
  if (missingFiles.length > 0) {
    throw new Error(`Missing required release assets: ${missingFiles.join(", ")}`);
  }
  const requiredFileSet = new Set(requiredFiles);
  const unexpectedFiles = actualFiles.filter((name) => !requiredFileSet.has(name));
  if (unexpectedFiles.length > 0) {
    throw new Error(`Unexpected release assets: ${unexpectedFiles.join(", ")}`);
  }

  for (const manifest of [...primaryManifests, ...promotedManifests]) {
    const path = join(options.releaseAssetsDir, manifest.name);
    const parsed = parseUpdateManifest(readFileSync(path, "utf8"), path, manifest.name);
    if (parsed.version !== options.version) {
      throw new Error(
        `${manifest.name} declares version ${parsed.version}; expected ${options.version}.`,
      );
    }

    const urls = new Set(parsed.files.map((file) => file.url));
    const missingEntries = manifest.assets.filter((asset) => !urls.has(asset));
    if (missingEntries.length > 0) {
      throw new Error(
        `${manifest.name} is missing required payload entries: ${missingEntries.join(", ")}`,
      );
    }
    for (const asset of manifest.assets) {
      const file = parsed.files.find((entry) => entry.url === asset);
      if (!file?.sha512 || !file.size || file.size <= 0) {
        throw new Error(`${manifest.name} has incomplete metadata for ${asset}.`);
      }
    }
  }

  return actualFiles.map((name) => join(options.releaseAssetsDir, basename(name)));
}

if (import.meta.main) {
  const parsed = parseArgs({
    options: {
      version: { type: "string" },
      channel: { type: "string" },
      "release-assets-dir": { type: "string" },
    },
  });
  const version = parsed.values.version;
  const channel = parsed.values.channel;
  const releaseAssetsDir = parsed.values["release-assets-dir"];
  if (!version || !releaseAssetsDir || (channel !== "stable" && channel !== "nightly")) {
    throw new Error("Expected --version, --channel=<stable|nightly>, and --release-assets-dir.");
  }

  const assets = validateReleaseAssets({ version, channel, releaseAssetsDir });
  console.log(`Validated ${assets.length} release assets for ${channel} ${version}.`);
}
