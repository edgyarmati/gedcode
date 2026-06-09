#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

export interface PromoteStableUpdateManifestsResult {
  readonly copied: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
  }>;
}

export function promoteStableUpdateManifestsToNightly(
  releaseAssetsDir: string,
): PromoteStableUpdateManifestsResult {
  if (!existsSync(releaseAssetsDir) || !statSync(releaseAssetsDir).isDirectory()) {
    throw new Error(`Release assets directory does not exist: ${releaseAssetsDir}`);
  }

  const copied: Array<{ readonly from: string; readonly to: string }> = [];
  for (const entry of readdirSync(releaseAssetsDir).toSorted()) {
    if (!/^latest.*\.ya?ml$/.test(entry)) {
      continue;
    }

    const targetName = entry.replace(/^latest/, "nightly");
    const from = join(releaseAssetsDir, entry);
    const to = join(releaseAssetsDir, targetName);
    cpSync(from, to);
    copied.push({ from: basename(from), to: basename(to) });
  }

  if (copied.length === 0) {
    throw new Error(`No latest updater manifests found in ${releaseAssetsDir}.`);
  }

  return { copied };
}

if (import.meta.main) {
  const parsed = parseArgs({
    options: {
      "release-assets-dir": {
        type: "string",
      },
    },
  });
  const releaseAssetsDir = parsed.values["release-assets-dir"];
  if (!releaseAssetsDir) {
    throw new Error("Missing required --release-assets-dir.");
  }

  const result = promoteStableUpdateManifestsToNightly(releaseAssetsDir);
  for (const copy of result.copied) {
    console.log(`Copied ${copy.from} -> ${copy.to}`);
  }
}
