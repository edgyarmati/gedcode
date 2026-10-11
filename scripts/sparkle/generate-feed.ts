#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Build-time release script: derives an Ed25519 public key and pipes the signing seed to Sparkle tools over stdin.
/**
 * Generates and verifies a release's Sparkle appcast.
 *
 * Runs Sparkle's own `generate_appcast` over the release's macOS zip, then
 * refuses to write anything unless the result is a feed existing installs will
 * accept: the signing seed must match the public key embedded in the app, the
 * appcast must point at this release's archive, and both the appcast and the
 * archive signatures must verify with Sparkle's `sign_update`. Shipping an
 * unverifiable feed is worse than shipping none, so every check fails closed.
 *
 *   SPARKLE_ED_PRIVATE_KEY=<seed> node scripts/sparkle/generate-feed.ts \
 *     --tag v0.5.1 --release-assets-dir release \
 *     --output-dir feed --sparkle-bin <electron-sparkle-updater>/native/vendor/bin
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  SPARKLE_ED_PUBLIC_KEY,
  sparkleAppcastAssetName,
  sparkleArchiveDownloadUrlPrefix,
} from "@t3tools/shared/sparkleUpdate";

import { isDesktopPreviewVersion, resolveDesktopUpdateChannel } from "../build-desktop-artifact.ts";

export interface SparkleFeedPlan {
  readonly archivePath: string;
  readonly appcastAssetName: string;
  readonly downloadUrlPrefix: string;
}

const RELEASE_TAG_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/;
/** PKCS#8 DER header for a raw 32-byte Ed25519 private key. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Sparkle exports its private key as a base64 32-byte Ed25519 seed. */
export function deriveSparklePublicKey(privateSeed: string): string {
  const seed = Buffer.from(privateSeed.trim(), "base64");
  if (seed.length !== 32) {
    throw new Error(
      `Sparkle private key must decode to a 32-byte Ed25519 seed, got ${seed.length}.`,
    );
  }
  const privateKey = NodeCrypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicDer = NodeCrypto.createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return publicDer.subarray(-32).toString("base64");
}

/** The feed is chosen from the tag the same way the build chose the feed URL
    it embedded, so a release can never land in a channel its app does not
    read. Preview builds are installed by hand and get no feed. */
export function planSparkleFeed(input: {
  readonly releaseAssets: ReadonlyArray<string>;
  readonly tag: string;
}): SparkleFeedPlan {
  if (!RELEASE_TAG_PATTERN.test(input.tag)) {
    throw new Error(`Invalid Sparkle release tag: ${input.tag}`);
  }
  const version = input.tag.slice(1);
  if (isDesktopPreviewVersion(version)) {
    throw new Error(`Preview release ${input.tag} has no Sparkle feed.`);
  }
  const zipAssets = input.releaseAssets.filter((entry) => entry.endsWith(".zip"));
  const [archivePath] = zipAssets;
  if (zipAssets.length !== 1 || archivePath === undefined) {
    throw new Error(`Expected exactly one macOS Sparkle zip, found ${zipAssets.length}.`);
  }
  return {
    archivePath,
    appcastAssetName: sparkleAppcastAssetName(resolveDesktopUpdateChannel(version)),
    downloadUrlPrefix: sparkleArchiveDownloadUrlPrefix(input.tag),
  };
}

/** Returns the archive's EdDSA signature from a generated appcast. */
export function validateGeneratedSparkleAppcast(input: {
  readonly xml: string;
  readonly expectedArchiveName: string;
  readonly expectedDownloadUrlPrefix: string;
}): string {
  if (!input.xml.includes(`sparkle:edSignature="`)) {
    throw new Error("Generated Sparkle appcast does not contain an archive Ed25519 signature.");
  }
  if (!input.xml.includes(`${input.expectedDownloadUrlPrefix}/${input.expectedArchiveName}`)) {
    throw new Error("Generated Sparkle appcast points at an unexpected release archive URL.");
  }
  const signature = input.xml.match(/sparkle:edSignature="([A-Za-z0-9+/=]+)"/)?.[1];
  if (!signature) {
    throw new Error("Generated Sparkle archive signature could not be parsed.");
  }
  return signature;
}

/** Runs a Sparkle tool with the seed on stdin, never on the command line. */
function runSparkleTool(
  tool: string,
  args: ReadonlyArray<string>,
  privateSeed: string,
): NodeChildProcess.SpawnSyncReturns<string> {
  return NodeChildProcess.spawnSync(tool, args, { encoding: "utf8", input: privateSeed });
}

export function generateSparkleFeed(input: {
  readonly tag: string;
  readonly releaseAssetsDir: string;
  readonly outputDir: string;
  readonly sparkleBin: string;
  readonly privateSeed: string | undefined;
  readonly expectedPublicKey?: string;
}): string {
  const privateSeed = input.privateSeed?.trim();
  if (!privateSeed) {
    throw new Error("SPARKLE_ED_PRIVATE_KEY is required; refusing to create an unsigned feed.");
  }
  if (deriveSparklePublicKey(privateSeed) !== (input.expectedPublicKey ?? SPARKLE_ED_PUBLIC_KEY)) {
    throw new Error(
      "SPARKLE_ED_PRIVATE_KEY does not match the public key embedded in GedCode; refusing release.",
    );
  }

  const plan = planSparkleFeed({
    releaseAssets: NodeFS.readdirSync(input.releaseAssetsDir).map((entry) =>
      NodePath.join(input.releaseAssetsDir, entry),
    ),
    tag: input.tag,
  });
  // generate_appcast reads every archive in its directory, so give it one
  // holding only this release's zip.
  const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gedcode-sparkle-feed-"));
  try {
    const archiveName = NodePath.basename(plan.archivePath);
    const stagedArchivePath = NodePath.join(workDir, archiveName);
    NodeFS.cpSync(plan.archivePath, stagedArchivePath);

    const generatedAppcastPath = NodePath.join(workDir, "appcast.xml");
    const generated = runSparkleTool(
      NodePath.join(input.sparkleBin, "generate_appcast"),
      [
        "--ed-key-file",
        "-",
        "--download-url-prefix",
        `${plan.downloadUrlPrefix}/`,
        "--maximum-versions",
        "1",
        "--maximum-deltas",
        "0",
        "-o",
        generatedAppcastPath,
        workDir,
      ],
      privateSeed,
    );
    if (generated.status !== 0) {
      throw new Error(`Sparkle generate_appcast failed: ${generated.stderr || generated.stdout}`);
    }

    const xml = NodeFS.readFileSync(generatedAppcastPath, "utf8");
    const archiveSignature = validateGeneratedSparkleAppcast({
      xml,
      expectedArchiveName: archiveName,
      expectedDownloadUrlPrefix: plan.downloadUrlPrefix,
    });
    const signUpdate = NodePath.join(input.sparkleBin, "sign_update");
    for (const [path, signature] of [
      [generatedAppcastPath, undefined],
      [stagedArchivePath, archiveSignature],
    ] as const) {
      const verified = runSparkleTool(
        signUpdate,
        ["--verify", "--ed-key-file", "-", path, ...(signature ? [signature] : [])],
        privateSeed,
      );
      if (verified.status !== 0) {
        throw new Error(`Sparkle signature verification failed for ${NodePath.basename(path)}.`);
      }
    }

    NodeFS.mkdirSync(input.outputDir, { recursive: true });
    const outputPath = NodePath.join(input.outputDir, plan.appcastAssetName);
    NodeFS.writeFileSync(outputPath, xml);
    return outputPath;
  } finally {
    NodeFS.rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      tag: { type: "string" },
      "release-assets-dir": { type: "string" },
      "output-dir": { type: "string" },
      "sparkle-bin": { type: "string" },
    },
  });
  const releaseAssetsDir = values["release-assets-dir"];
  const outputDir = values["output-dir"];
  const sparkleBin = values["sparkle-bin"];
  if (!values.tag || !releaseAssetsDir || !outputDir || !sparkleBin) {
    throw new Error(
      "Usage: generate-feed.ts --tag <tag> --release-assets-dir <dir> --output-dir <dir> --sparkle-bin <dir>",
    );
  }
  const outputPath = generateSparkleFeed({
    tag: values.tag,
    releaseAssetsDir,
    outputDir,
    sparkleBin,
    privateSeed: process.env.SPARKLE_ED_PRIVATE_KEY,
  });
  process.stdout.write(`Generated and verified ${outputPath}\n`);
}
