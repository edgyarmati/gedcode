#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off

import desktopPackageJson from "../apps/desktop/package.json" with { type: "json" };

import { parseArgs } from "node:util";

type ReleaseChannel = "stable" | "nightly" | "dev";
type VersionBump = "major" | "minor" | "patch";

const ReleaseChannels = new Set<ReleaseChannel>(["stable", "nightly", "dev"]);
const VersionBumps = new Set<VersionBump>(["major", "minor", "patch"]);

function resolveStableCore(version: string): string {
  return version.replace(/^v/, "").replace(/[-+].*$/, "");
}

function parseStableCore(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(resolveStableCore(version));
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Invalid package version: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

export function bumpStableVersion(version: string, bump: VersionBump): string {
  const [major, minor, patch] = parseStableCore(version);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function timestampForDevVersion(): string {
  const now = new Date();
  const date = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const time = [
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  return `${date}.${time}`;
}

export function resolveReleaseVersion(input: {
  readonly currentVersion: string;
  readonly channel: ReleaseChannel;
  readonly bump: VersionBump;
  readonly date?: string;
  readonly runNumber?: string;
}): string {
  const stableVersion = bumpStableVersion(input.currentVersion, input.bump);
  if (input.channel === "stable") {
    return stableVersion;
  }
  if (input.channel === "nightly") {
    const date = input.date ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const runNumber = input.runNumber ?? "1";
    return `${stableVersion}-nightly.${date}.${runNumber}`;
  }
  return `${stableVersion}-dev.${timestampForDevVersion()}`;
}

if (import.meta.main) {
  const parsed = parseArgs({
    options: {
      channel: { type: "string" },
      bump: { type: "string" },
      date: { type: "string" },
      "run-number": { type: "string" },
    },
  });

  const channel = parsed.values.channel;
  const bump = parsed.values.bump;
  if (!ReleaseChannels.has(channel as ReleaseChannel)) {
    throw new Error("--channel must be stable, nightly, or dev.");
  }
  if (!VersionBumps.has(bump as VersionBump)) {
    throw new Error("--bump must be major, minor, or patch.");
  }

  console.log(
    resolveReleaseVersion({
      currentVersion: desktopPackageJson.version,
      channel: channel as ReleaseChannel,
      bump: bump as VersionBump,
      ...(parsed.values.date !== undefined ? { date: parsed.values.date } : {}),
      ...(parsed.values["run-number"] !== undefined
        ? { runNumber: parsed.values["run-number"] }
        : {}),
    }),
  );
}
