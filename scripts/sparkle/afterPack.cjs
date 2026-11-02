// electron-builder loads this hook by path from the serialized build config.
// Prepare upstream's cache before signing so the seal covers every staged file.
module.exports = async function sparkleAfterPack(context) {
  await require("../prepare-server-compile-cache.cjs")(context);
  const { adHocSignAfterPack } = require("electron-sparkle-updater/builder");
  return adHocSignAfterPack(context);
};
