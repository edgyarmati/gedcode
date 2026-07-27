#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

export interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (args: ReadonlyArray<string>) => CommandResult;

export interface PublishGithubReleaseOptions {
  readonly tag: string;
  readonly target: string;
  readonly name: string;
  readonly previousTag?: string;
  readonly prerelease: boolean;
  readonly makeLatest: boolean;
  readonly releaseAssetsDir: string;
  readonly notes: string;
}

const REQUIRED_ASSET_EXTENSIONS = [".dmg", ".zip", ".AppImage", ".exe", ".blockmap", ".yml"];

export function extractReleaseNotes(changelog: string, tag: string): string {
  const version = tag.replace(/^v/, "");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##[\\t ]+v?${escapedVersion}(?:[\\t ]|$)`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(`CHANGELOG.md does not contain a release section for ${tag}.`);
  }

  const endOffset = lines.slice(start + 1).findIndex((line) => /^##[\t ]+/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  const notes = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  if (notes.length === 0) {
    throw new Error(`CHANGELOG.md release section for ${tag} is empty.`);
  }
  return notes;
}

function listReleaseAssets(releaseAssetsDir: string): ReadonlyArray<string> {
  if (!statSync(releaseAssetsDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Release assets directory does not exist: ${releaseAssetsDir}`);
  }

  const entries = readdirSync(releaseAssetsDir).toSorted();
  const missing = REQUIRED_ASSET_EXTENSIONS.filter(
    (extension) => !entries.some((entry) => entry.endsWith(extension)),
  );
  if (missing.length > 0) {
    throw new Error(`Missing required release assets: ${missing.join(", ")}`);
  }

  return entries
    .filter((entry) => REQUIRED_ASSET_EXTENSIONS.some((extension) => entry.endsWith(extension)))
    .map((entry) => join(releaseAssetsDir, entry));
}

function assertSucceeded(action: string, result: CommandResult): void {
  if (result.status === 0) return;
  throw new Error(`${action} failed: ${result.stderr.trim() || result.stdout.trim()}`);
}

export function publishGithubRelease(
  options: PublishGithubReleaseOptions,
  run: CommandRunner,
): "created" | "updated" {
  const assets = listReleaseAssets(options.releaseAssetsDir);
  const existing = run(["release", "view", options.tag, "--json", "tagName"]);

  if (existing.status === 0) {
    assertSucceeded(
      "Release asset upload",
      run(["release", "upload", options.tag, ...assets, "--clobber"]),
    );
    assertSucceeded(
      "Release metadata update",
      run([
        "release",
        "edit",
        options.tag,
        "--target",
        options.target,
        "--title",
        options.name,
        "--notes",
        options.notes,
        `--prerelease=${options.prerelease}`,
        `--latest=${options.makeLatest}`,
      ]),
    );
    return "updated";
  }

  const notFound = `${existing.stdout}\n${existing.stderr}`.toLowerCase();
  if (!notFound.includes("release not found") && !notFound.includes("http 404")) {
    throw new Error(`Release lookup failed: ${existing.stderr.trim() || existing.stdout.trim()}`);
  }

  const args = [
    "release",
    "create",
    options.tag,
    ...assets,
    "--target",
    options.target,
    "--title",
    options.name,
    "--notes",
    options.notes,
    `--latest=${options.makeLatest}`,
  ];
  if (options.prerelease) {
    args.push("--prerelease");
  }

  assertSucceeded("Release creation", run(args));
  return "created";
}

const runGh: CommandRunner = (args) => {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
};

if (import.meta.main) {
  const parsed = parseArgs({
    options: {
      tag: { type: "string" },
      target: { type: "string" },
      name: { type: "string" },
      "previous-tag": { type: "string" },
      prerelease: { type: "string" },
      "make-latest": { type: "string" },
      "release-assets-dir": { type: "string" },
    },
  });
  const tag = parsed.values.tag;
  const target = parsed.values.target;
  const name = parsed.values.name;
  const prerelease = parsed.values.prerelease;
  const makeLatest = parsed.values["make-latest"];
  const releaseAssetsDir = parsed.values["release-assets-dir"];
  if (!tag || !target || !name || !releaseAssetsDir) {
    throw new Error("Missing required release publication argument.");
  }
  if (!prerelease || !["true", "false"].includes(prerelease)) {
    throw new Error("--prerelease must be true or false.");
  }
  if (!makeLatest || !["true", "false"].includes(makeLatest)) {
    throw new Error("--make-latest must be true or false.");
  }

  const previousTag = parsed.values["previous-tag"];
  const result = publishGithubRelease(
    {
      tag,
      target,
      name,
      ...(previousTag ? { previousTag } : {}),
      prerelease: prerelease === "true",
      makeLatest: makeLatest === "true",
      releaseAssetsDir,
      notes: extractReleaseNotes(readFileSync("CHANGELOG.md", "utf8"), tag),
    },
    runGh,
  );
  console.log(`GitHub release ${result}: ${tag}`);
}
