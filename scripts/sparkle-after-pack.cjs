const { execFileSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Sparkle's framework and native bridge are staged before this hook runs. A
 * Developer ID build is signed by electron-builder after packaging; an
 * unsigned build needs a complete ad-hoc signature so Sparkle accepts the
 * archive and macOS does not report a damaged resource seal.
 */
module.exports = async function sparkleAfterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const hasDeveloperIdentity = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
  if (hasDeveloperIdentity) return;

  const appName = readdirSync(context.appOutDir).find((entry) => entry.endsWith(".app"));
  if (!appName) {
    throw new Error(`Sparkle afterPack could not find an app bundle in ${context.appOutDir}`);
  }

  const appPath = join(context.appOutDir, appName);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
};
