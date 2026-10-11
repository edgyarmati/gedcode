import { assert, describe, it } from "@effect/vitest";
import { SPARKLE_ED_PUBLIC_KEY } from "@t3tools/shared/sparkleUpdate";

import {
  deriveSparklePublicKey,
  generateSparkleFeed,
  planSparkleFeed,
  validateGeneratedSparkleAppcast,
} from "./generate-feed.ts";

/** A throwaway key pair made for these tests; it signs nothing real. */
const TEST_SEED = "A9fPmM+koWkltjpUg5sbRletMaRb31zfqoMqxRJN0bw=";
const TEST_PUBLIC_KEY = "GUqJiFFMoqq6eNrN5qgHgy2Nck69Y2/8SXO9ebaICrI=";

const RELEASE_PREFIX = "https://github.com/edgyarmati/gedcode/releases/download/v0.5.1";

describe("Sparkle feed generation", () => {
  it("selects one macOS archive and a channel-specific durable feed name", () => {
    assert.deepEqual(
      planSparkleFeed({
        releaseAssets: ["/release/GedCode-0.5.1-arm64.zip", "/release/GedCode-0.5.1-arm64.dmg"],
        tag: "v0.5.1",
      }),
      {
        archivePath: "/release/GedCode-0.5.1-arm64.zip",
        appcastAssetName: "appcast-latest.xml",
        downloadUrlPrefix: RELEASE_PREFIX,
      },
    );
  });

  it("publishes nightlies to the feed nightly builds read", () => {
    const plan = planSparkleFeed({
      releaseAssets: ["/release/GedCode-0.5.2-nightly.20261011.3-arm64.zip"],
      tag: "v0.5.2-nightly.20261011.3",
    });
    assert.equal(plan.appcastAssetName, "appcast-nightly.xml");
  });

  it("gives preview builds no feed", () => {
    for (const tag of ["v0.5.2-pr.41.1", "v0.5.2-preview.20261011.1"]) {
      assert.throws(
        () => planSparkleFeed({ releaseAssets: ["/release/GedCode.zip"], tag }),
        /has no Sparkle feed/,
      );
    }
  });

  it("rejects ambiguous archives and unsafe tags", () => {
    assert.throws(() => planSparkleFeed({ releaseAssets: [], tag: "v0.5.1" }), /exactly one/);
    assert.throws(
      () =>
        planSparkleFeed({
          releaseAssets: ["/release/a.zip", "/release/b.zip"],
          tag: "v0.5.1",
        }),
      /exactly one/,
    );
    assert.throws(
      () =>
        planSparkleFeed({
          releaseAssets: ["/release/GedCode.zip"],
          tag: "$(unsafe)",
        }),
      /Invalid Sparkle release tag/,
    );
  });

  it("derives an Ed25519 public key from Sparkle's exported seed format", () => {
    // RFC 8032 test vector 1.
    const seed = Buffer.from(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
      "hex",
    ).toString("base64");
    assert.equal(
      deriveSparklePublicKey(seed),
      Buffer.from(
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "hex",
      ).toString("base64"),
    );
    assert.equal(deriveSparklePublicKey(TEST_SEED), TEST_PUBLIC_KEY);
    // Sparkle's tools reject a 64-byte seed-plus-public-key export too.
    const seedAndPublicKey = Buffer.concat([
      Buffer.from(TEST_SEED, "base64"),
      Buffer.from(TEST_PUBLIC_KEY, "base64"),
    ]).toString("base64");
    assert.throws(() => deriveSparklePublicKey(seedAndPublicKey), /32-byte/);
  });

  it("requires an archive signature and exact release URL", () => {
    const xml = [
      "<rss>",
      `<enclosure url="${RELEASE_PREFIX}/GedCode.zip" sparkle:edSignature="YWJjZA==" />`,
      "</rss>",
    ].join("");
    assert.equal(
      validateGeneratedSparkleAppcast({
        xml,
        expectedArchiveName: "GedCode.zip",
        expectedDownloadUrlPrefix: RELEASE_PREFIX,
      }),
      "YWJjZA==",
    );
    assert.throws(
      () =>
        validateGeneratedSparkleAppcast({
          xml: xml.replace("v0.5.1", "v0.5.2"),
          expectedArchiveName: "GedCode.zip",
          expectedDownloadUrlPrefix: RELEASE_PREFIX,
        }),
      /unexpected release archive URL/,
    );
    assert.throws(
      () =>
        validateGeneratedSparkleAppcast({
          xml: xml.replace(' sparkle:edSignature="YWJjZA=="', ""),
          expectedArchiveName: "GedCode.zip",
          expectedDownloadUrlPrefix: RELEASE_PREFIX,
        }),
      /Ed25519 signature/,
    );
  });

  describe("refuses before touching the release", () => {
    const input = {
      tag: "v0.5.1",
      releaseAssetsDir: "/nonexistent/release",
      outputDir: "/nonexistent/feed",
      sparkleBin: "/nonexistent/bin",
    } as const;

    it("without a signing seed", () => {
      for (const privateSeed of [undefined, "", "  \n"]) {
        assert.throws(
          () => generateSparkleFeed({ ...input, privateSeed }),
          /refusing to create an unsigned feed/,
        );
      }
    });

    it("with a seed that does not match the embedded public key", () => {
      assert.notEqual(TEST_PUBLIC_KEY, SPARKLE_ED_PUBLIC_KEY);
      assert.throws(
        () => generateSparkleFeed({ ...input, privateSeed: TEST_SEED }),
        /does not match the public key embedded in GedCode/,
      );
    });
  });
});
