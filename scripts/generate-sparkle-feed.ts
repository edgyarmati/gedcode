#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { parseArgs } from "node:util";

import {
  SPARKLE_ED_PUBLIC_KEY,
  type SparkleUpdateChannel,
  sparkleAppcastAssetName,
} from "@t3tools/shared/sparkleUpdate";

const GITHUB_RELEASE_DOWNLOAD_BASE = "https://github.com/edgyarmati/gedcode/releases/download";

export interface SparkleFeedPlan {
  readonly archivePath: string;
  readonly appcastAssetName: string;
  readonly downloadUrlPrefix: string;
}

export function deriveSparklePublicKey(privateKey: string): string {
  const seed = Buffer.from(privateKey.trim(), "base64");
  if (seed.length !== 32) {
    throw new Error(
      `Sparkle private key must decode to a 32-byte Ed25519 seed, got ${seed.length}.`,
    );
  }
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKeyObject = createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicDer = createPublicKey(privateKeyObject).export({ format: "der", type: "spki" });
  return publicDer.subarray(-32).toString("base64");
}

export function planSparkleFeed(input: {
  readonly releaseAssets: ReadonlyArray<string>;
  readonly tag: string;
  readonly channel: SparkleUpdateChannel;
}): SparkleFeedPlan {
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(input.tag)) {
    throw new Error(`Invalid Sparkle release tag: ${input.tag}`);
  }
  const zipAssets = input.releaseAssets.filter((entry) => entry.endsWith(".zip"));
  if (zipAssets.length !== 1) {
    throw new Error(`Expected exactly one macOS Sparkle zip, found ${zipAssets.length}.`);
  }
  return {
    archivePath: zipAssets[0]!,
    appcastAssetName: sparkleAppcastAssetName(input.channel),
    downloadUrlPrefix: `${GITHUB_RELEASE_DOWNLOAD_BASE}/${input.tag}`,
  };
}

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

if (import.meta.main) {
  const parsed = parseArgs({
    options: {
      tag: { type: "string" },
      channel: { type: "string" },
      "release-assets-dir": { type: "string" },
      "output-dir": { type: "string" },
      "sparkle-bin": { type: "string" },
    },
  });
  const tag = parsed.values.tag;
  const rawChannel = parsed.values.channel;
  const releaseAssetsDir = parsed.values["release-assets-dir"];
  const outputDir = parsed.values["output-dir"];
  const sparkleBin = parsed.values["sparkle-bin"];
  if (!tag || !releaseAssetsDir || !outputDir || !sparkleBin) {
    throw new Error("Missing required Sparkle feed generation argument.");
  }
  if (rawChannel !== "latest" && rawChannel !== "nightly") {
    throw new Error("--channel must be latest or nightly.");
  }
  const privateKey = process.env.SPARKLE_ED_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error("SPARKLE_ED_PRIVATE_KEY is required; refusing to create an unsigned feed.");
  }
  const derivedPublicKey = deriveSparklePublicKey(privateKey);
  if (derivedPublicKey !== SPARKLE_ED_PUBLIC_KEY) {
    throw new Error(
      "SPARKLE_ED_PRIVATE_KEY does not match the public key embedded in GedCode; refusing release.",
    );
  }

  const releaseAssets = readdirSync(releaseAssetsDir).map((entry) => join(releaseAssetsDir, entry));
  const plan = planSparkleFeed({
    releaseAssets,
    tag,
    channel: rawChannel,
  });
  const workDir = mkdtempSync(join(tmpdir(), "gedcode-sparkle-feed-"));
  const archiveName = basename(plan.archivePath);
  const stagedArchivePath = join(workDir, archiveName);
  cpSync(plan.archivePath, stagedArchivePath);

  const generatedAppcastPath = join(workDir, "appcast.xml");
  const generateResult = spawnSync(
    join(sparkleBin, "generate_appcast"),
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
    { encoding: "utf8", input: privateKey },
  );
  if (generateResult.status !== 0) {
    throw new Error(
      `Sparkle generate_appcast failed: ${generateResult.stderr || generateResult.stdout}`,
    );
  }

  const xml = readFileSync(generatedAppcastPath, "utf8");
  const archiveSignature = validateGeneratedSparkleAppcast({
    xml,
    expectedArchiveName: archiveName,
    expectedDownloadUrlPrefix: plan.downloadUrlPrefix,
  });
  const signUpdate = join(sparkleBin, "sign_update");
  for (const [path, signature] of [
    [generatedAppcastPath, undefined],
    [stagedArchivePath, archiveSignature],
  ] as const) {
    const verifyResult = spawnSync(
      signUpdate,
      ["--verify", "--ed-key-file", "-", path, ...(signature ? [signature] : [])],
      { encoding: "utf8", input: privateKey },
    );
    if (verifyResult.status !== 0) {
      throw new Error(`Sparkle signature verification failed for ${basename(path)}.`);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, plan.appcastAssetName);
  writeFileSync(outputPath, xml);
  console.log(`Generated and verified ${outputPath}`);
}
