// @effect-diagnostics nodeBuiltinImport:off

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collapseReleaseNoteSections,
  extractReleaseNotes,
  publishGithubRelease,
  type CommandResult,
  type PublishGithubReleaseOptions,
} from "./publish-github-release.ts";

function assetsDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "gedcode-release-"));
  const directory = join(root, "assets");
  mkdirSync(directory);
  const assets = [
    "GedCode-0.3.0-arm64.dmg",
    "GedCode-0.3.0-arm64.zip",
    "GedCode-0.3.0-x86_64.AppImage",
    "GedCode-0.3.0-x64.exe",
    "GedCode-0.3.0-x64.exe.blockmap",
  ];
  for (const name of assets) {
    writeFileSync(join(directory, name), name);
  }
  const manifests = {
    "latest-linux.yml": assets.slice(2, 3),
    "latest.yml": assets.slice(3),
  };
  for (const [name, manifestAssets] of Object.entries(manifests)) {
    const manifest = [
      "version: 0.3.0",
      "files:",
      ...manifestAssets.flatMap((asset, index) => [
        `  - url: ${asset}`,
        `    sha512: hash-${index}`,
        `    size: ${100 + index}`,
      ]),
      `path: ${manifestAssets[0]}`,
      "sha512: hash-0",
      "releaseDate: '2026-08-27T00:00:00.000Z'",
      "",
    ].join("\n");
    writeFileSync(join(directory, name), manifest);
    writeFileSync(join(directory, name.replace(/^latest/, "nightly")), manifest);
  }
  return directory;
}

const options = (overrides: Partial<PublishGithubReleaseOptions> = {}) => ({
  tag: "v0.3.0",
  version: "0.3.0",
  releaseChannel: "stable" as const,
  target: "abc123",
  name: "GedCode v0.3.0",
  previousTag: "v0.2.1",
  prerelease: false,
  makeLatest: true,
  releaseAssetsDir: assetsDirectory(),
  notes: "Extensive release notes.",
  ...overrides,
});

const ok: CommandResult = { status: 0, stdout: "", stderr: "" };

describe("publish-github-release", () => {
  it("creates a release with changelog notes, explicit metadata, and all assets", () => {
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
        "--notes",
        "Extensive release notes.",
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
      "--notes",
      "Extensive release notes.",
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

  it("extracts only the requested changelog release section", () => {
    expect(
      extractReleaseNotes(
        [
          "# Changelog",
          "",
          "## Unreleased",
          "",
          "- Future change",
          "",
          "## 0.4.0 - 2026-07-27",
          "",
          "Major release.",
          "",
          "### Highlights",
          "",
          "- Durable workflows",
          "",
          "## 0.3.0 - 2026-06-01",
          "",
          "Previous release.",
        ].join("\n"),
        "v0.4.0",
      ),
    ).toBe("Major release.\n\n### Highlights\n\n- Durable workflows");
  });

  it("fails closed when changelog notes are missing or empty", () => {
    expect(() => extractReleaseNotes("## 0.3.0\nOld notes", "v0.4.0")).toThrow(
      "does not contain a release section",
    );
    expect(() => extractReleaseNotes("## 0.4.0\n\n## 0.3.0\nOld notes", "v0.4.0")).toThrow(
      "release section for v0.4.0 is empty",
    );
  });

  it("keeps highlights visible and collapses each detailed section", () => {
    expect(
      collapseReleaseNoteSections(
        [
          "Executive summary.",
          "",
          "### Highlights",
          "",
          "- Visible highlight",
          "",
          "### Reliability & recovery",
          "",
          "- Detailed fix",
          "",
          "### Provider support",
          "",
          "- New model",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Executive summary.",
        "",
        "### Highlights",
        "",
        "- Visible highlight",
        "<details>",
        "<summary><strong>Reliability &amp; recovery</strong></summary>",
        "",
        "- Detailed fix",
        "",
        "</details>",
        "<details>",
        "<summary><strong>Provider support</strong></summary>",
        "",
        "- New model",
        "",
        "</details>",
      ].join("\n"),
    );
  });
});
