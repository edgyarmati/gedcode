import { assert, describe, it } from "@effect/vitest";
import { SPARKLE_ED_PUBLIC_KEY, sparkleAppcastUrl } from "@t3tools/shared/sparkleUpdate";

import { SPARKLE_AFTER_PACK_SCRIPT, applySparkleBuildConfig } from "./buildConfig.ts";

const baseConfig = {
  appId: "com.example.app",
  files: ["!**/*.map"],
  extraResources: [{ from: "a", to: "b" }],
  mac: {
    target: ["dmg", "zip"],
    extendInfo: { NSLocalNetworkUsageDescription: "local network" },
  },
  dmg: { title: "Installer", iconSize: 120 },
};

describe("applySparkleBuildConfig", () => {
  const config = applySparkleBuildConfig(baseConfig, {
    platform: "mac",
    channel: "nightly",
    localizations: ["en-US"],
  });

  it("embeds the feed and public key Sparkle reads at launch", () => {
    const extendInfo = (config.mac as { extendInfo: Record<string, unknown> }).extendInfo;
    assert.equal(extendInfo.SUFeedURL, sparkleAppcastUrl("nightly"));
    assert.equal(extendInfo.SUPublicEDKey, SPARKLE_ED_PUBLIC_KEY);
    assert.deepEqual(extendInfo.CFBundleLocalizations, ["en-US"]);
    assert.equal(extendInfo.SUEnableInstallerLauncherService, false);
  });

  it("requires signed feeds and leaves scheduling to DesktopUpdates", () => {
    const extendInfo = (config.mac as { extendInfo: Record<string, unknown> }).extendInfo;
    assert.equal(extendInfo.SURequireSignedFeed, true);
    assert.equal(extendInfo.SUVerifyUpdateBeforeExtraction, true);
    assert.equal(extendInfo.SUSignedFeedFailureExpirationInterval, 0);
    assert.equal(extendInfo.SUEnableAutomaticChecks, false);
    assert.equal(extendInfo.SUAllowsAutomaticUpdates, false);
    assert.equal(extendInfo.SUAutomaticallyUpdate, false);
  });

  it("keeps the app's own configuration", () => {
    const mac = config.mac as { target: unknown; extendInfo: Record<string, unknown> };
    assert.deepEqual(mac.target, ["dmg", "zip"]);
    assert.equal(mac.extendInfo.NSLocalNetworkUsageDescription, "local network");
    assert.deepEqual(config.dmg, { title: "Installer", iconSize: 120, writeUpdateInfo: false });
    assert.deepEqual(config.extraResources, baseConfig.extraResources);
    assert.equal((config.files as Array<string>)[0], "!**/*.map");
  });

  it("ships the framework beside the asar", () => {
    assert.deepEqual(config.extraFiles, [
      {
        from: "node_modules/electron-sparkle-updater/native/vendor/Sparkle.framework",
        to: "Frameworks/Sparkle.framework",
      },
    ]);
    assert.include(
      config.files as Array<string>,
      "!**/node_modules/electron-sparkle-updater/native/vendor/**",
    );
    // Smart unpack extracts the addon, as for every other native package.
    assert.notProperty(config, "asarUnpack");
    assert.equal(config.afterPack, SPARKLE_AFTER_PACK_SCRIPT);
  });

  it("only sets options electron-builder 26 accepts", () => {
    // A top-level `zip` key fails electron-builder's schema validation.
    assert.notProperty(config, "zip");
  });

  it("leaves other platforms' configs alone", () => {
    for (const platform of ["linux", "win"] as const) {
      const other = applySparkleBuildConfig(baseConfig, {
        platform,
        channel: "latest",
        localizations: ["en-US"],
      });
      assert.strictEqual(other, baseConfig);
    }
  });

  it("does not modify the config it is given", () => {
    assert.deepEqual(baseConfig.mac.extendInfo, {
      NSLocalNetworkUsageDescription: "local network",
    });
    assert.deepEqual(baseConfig.files, ["!**/*.map"]);
    assert.deepEqual(baseConfig.dmg, { title: "Installer", iconSize: 120 });
  });
});
