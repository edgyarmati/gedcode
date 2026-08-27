import { describe, expect, it } from "vitest";

import {
  deriveSparklePublicKey,
  planSparkleFeed,
  validateGeneratedSparkleAppcast,
} from "./generate-sparkle-feed.ts";

describe("Sparkle feed generation", () => {
  it("selects one macOS archive and a channel-specific durable feed name", () => {
    expect(
      planSparkleFeed({
        releaseAssets: ["/release/GedCode-0.4.4-arm64.zip", "/release/GedCode-0.4.4-arm64.dmg"],
        tag: "v0.4.4",
        channel: "latest",
      }),
    ).toEqual({
      archivePath: "/release/GedCode-0.4.4-arm64.zip",
      appcastAssetName: "appcast-latest.xml",
      downloadUrlPrefix: "https://github.com/edgyarmati/gedcode/releases/download/v0.4.4",
    });
  });

  it("rejects ambiguous archives and unsafe tags", () => {
    expect(() => planSparkleFeed({ releaseAssets: [], tag: "v0.4.4", channel: "latest" })).toThrow(
      "exactly one",
    );
    expect(() =>
      planSparkleFeed({
        releaseAssets: ["/release/GedCode.zip"],
        tag: "$(unsafe)",
        channel: "latest",
      }),
    ).toThrow("Invalid Sparkle release tag");
  });

  it("derives an Ed25519 public key from Sparkle's exported seed format", () => {
    const seed = Buffer.from(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
      "hex",
    ).toString("base64");
    expect(deriveSparklePublicKey(seed)).toBe(
      Buffer.from(
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "hex",
      ).toString("base64"),
    );
  });

  it("requires an archive signature and exact release URL", () => {
    const xml = [
      "<rss>",
      '<enclosure url="https://github.com/edgyarmati/gedcode/releases/download/v0.4.4/GedCode.zip" sparkle:edSignature="YWJjZA==" />',
      "</rss>",
    ].join("");
    expect(
      validateGeneratedSparkleAppcast({
        xml,
        expectedArchiveName: "GedCode.zip",
        expectedDownloadUrlPrefix: "https://github.com/edgyarmati/gedcode/releases/download/v0.4.4",
      }),
    ).toBe("YWJjZA==");
    expect(() =>
      validateGeneratedSparkleAppcast({
        xml: xml.replace("v0.4.4", "v0.4.5"),
        expectedArchiveName: "GedCode.zip",
        expectedDownloadUrlPrefix: "https://github.com/edgyarmati/gedcode/releases/download/v0.4.4",
      }),
    ).toThrow("unexpected release archive URL");
  });
});
