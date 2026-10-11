// electron-builder loads `afterPack` by path and calls its default export. The hook itself lives in electron-sparkle-updater,
// which is ESM-only, so load it dynamically rather than copying what it does:
// copying in the framework, the unpacked addon, and the extra resources
// invalidates the app's ad-hoc code signature, and Sparkle's generate_appcast
// refuses an archive whose .app fails `codesign --verify --deep --strict`.
module.exports = async function sparkleAfterPack(context) {
  const { adHocSignAfterPack } = await import("electron-sparkle-updater/builder");
  return adHocSignAfterPack(context);
};
