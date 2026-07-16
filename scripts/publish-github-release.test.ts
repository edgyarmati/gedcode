// @effect-diagnostics nodeBuiltinImport:off

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  publishGithubRelease,
  type CommandResult,
  type PublishGithubReleaseOptions,
} from "./publish-github-release.ts";

function assetsDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "gedcode-release-"));
  const directory = join(root, "assets");
  mkdirSync(directory);
  for (const name of [
    "GedCode.dmg",
    "GedCode.zip",
    "GedCode.AppImage",
    "GedCode.exe",
    "GedCode.exe.blockmap",
    "latest.yml",
  ]) {
    writeFileSync(join(directory, name), name);
  }
  return directory;
}

const options = (overrides: Partial<PublishGithubReleaseOptions> = {}) => ({
  tag: "v0.3.0",
  target: "abc123",
  name: "GedCode v0.3.0",
  previousTag: "v0.2.1",
  prerelease: false,
  makeLatest: true,
  releaseAssetsDir: assetsDirectory(),
  ...overrides,
});

const ok: CommandResult = { status: 0, stdout: "", stderr: "" };

describe("publish-github-release", () => {
  it("creates a release with the explicit tag, target, notes range, metadata, and all assets", () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const result = publishGithubRelease(options(), (args) => {
      calls.push(args);
      return calls.length === 1 ? { status: 1, stdout: "", stderr: "release not found" } : ok;
    });

    expect(result).toBe("created");
    expect(calls[0]).toEqual(["release", "view", "v0.3.0", "--json", "tagName"]);
    expect(calls[1]).toEqual(
      expect.arrayContaining([
        "release",
        "create",
        "v0.3.0",
        "--target",
        "abc123",
        "--title",
        "GedCode v0.3.0",
        "--generate-notes",
        "--notes-start-tag",
        "v0.2.1",
        "--latest=true",
      ]),
    );
    expect(calls[1]?.filter((argument) => argument.includes("GedCode"))).toHaveLength(6);
  });

  it("reconciles an existing release with clobbered assets and explicit metadata", () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const result = publishGithubRelease(
      options({ prerelease: true, makeLatest: false }),
      (args) => {
        calls.push(args);
        return ok;
      },
    );

    expect(result).toBe("updated");
    expect(calls[1]?.slice(0, 3)).toEqual(["release", "upload", "v0.3.0"]);
    expect(calls[1]).toContain("--clobber");
    expect(calls[2]).toEqual([
      "release",
      "edit",
      "v0.3.0",
      "--target",
      "abc123",
      "--title",
      "GedCode v0.3.0",
      "--prerelease=true",
      "--latest=false",
    ]);
  });

  it("fails closed on lookup errors instead of mistaking them for an absent release", () => {
    expect(() =>
      publishGithubRelease(options(), () => ({
        status: 1,
        stdout: "",
        stderr: "HTTP 503 Service Unavailable",
      })),
    ).toThrow("Release lookup failed: HTTP 503 Service Unavailable");
  });

  it("requires every platform and updater asset class", () => {
    const directory = assetsDirectory();
    const incomplete = join(directory, "incomplete");
    mkdirSync(incomplete);
    writeFileSync(join(incomplete, "GedCode.zip"), "zip");

    expect(() => publishGithubRelease(options({ releaseAssetsDir: incomplete }), () => ok)).toThrow(
      "Missing required release assets",
    );
  });
});
