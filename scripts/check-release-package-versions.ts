#!/usr/bin/env bun
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseJsonc } from "jsonc-parser";

import { releasePackageFiles } from "./lib/release-package-files.ts";

interface BunLockWorkspace {
  readonly version?: unknown;
}

interface BunLock {
  readonly workspaces?: Record<string, BunLockWorkspace>;
}

export function checkReleasePackageVersionConsistency(rootDir = process.cwd()): string {
  const versions = releasePackageFiles.map((relativePath) => {
    const packageJson = JSON.parse(readFileSync(resolve(rootDir, relativePath), "utf8")) as {
      readonly version?: unknown;
    };
    if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
      throw new Error(`${relativePath} does not contain a valid version.`);
    }
    return { relativePath, workspace: dirname(relativePath), version: packageJson.version };
  });
  const expected = versions[0]?.version;
  if (!expected) throw new Error("No release packages are configured.");

  const mismatchedManifests = versions.filter(({ version }) => version !== expected);
  if (mismatchedManifests.length > 0) {
    throw new Error(
      `Release package versions disagree: ${versions
        .map(({ relativePath, version }) => `${relativePath}=${version}`)
        .join(", ")}`,
    );
  }

  const lock = parseJsonc(readFileSync(resolve(rootDir, "bun.lock"), "utf8")) as BunLock;
  const mismatchedLockWorkspaces = versions.filter(
    ({ workspace }) => lock.workspaces?.[workspace]?.version !== expected,
  );
  if (mismatchedLockWorkspaces.length > 0) {
    throw new Error(
      `bun.lock workspace versions do not match ${expected}: ${mismatchedLockWorkspaces
        .map(({ workspace }) => `${workspace}=${String(lock.workspaces?.[workspace]?.version)}`)
        .join(", ")}`,
    );
  }

  return expected;
}

if (import.meta.main) {
  const parsed = parseArgs({ options: { root: { type: "string" } } });
  const version = checkReleasePackageVersionConsistency(parsed.values.root);
  console.log(`Release package manifests and bun.lock agree on ${version}.`);
}
