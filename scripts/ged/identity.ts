import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * GedCode's identity, applied to the desktop build rather than threaded
 * through upstream's sources: the bundle identity, product names and URL
 * schemes in the electron-builder config, and the user-visible product name in
 * the staged bundles. Doing it at build time keeps the ~200 upstream files
 * that say "T3 Code" unmodified, so they keep merging cleanly.
 *
 * Runtime identity that must also hold in development (data directories, the
 * renderer's URL scheme, the window/app name) is set in the sources
 * themselves; see `.ged/STANDARDS.md`.
 */

export const GED_APP_ID = "com.t3tools.gedcode";
export const GED_PRODUCT_NAME = "GedCode";
export const GED_URL_SCHEMES = ["gedcode", "gedcode-dev"] as const;
export const GED_REPOSITORY_URL = "https://github.com/edgyarmati/gedcode";

/** Upstream's product names, most specific first. "Alpha" is upstream's
    stable stage; a stable GedCode is plain "GedCode", as v0.4 was. */
const PRODUCT_NAME_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["T3 Code (Alpha)", GED_PRODUCT_NAME],
  ["T3 Code (Nightly)", `${GED_PRODUCT_NAME} (Nightly)`],
  ["T3 Code (Dev)", `${GED_PRODUCT_NAME} (Dev)`],
  ["T3 Code", GED_PRODUCT_NAME],
  ["T3 Connect", `${GED_PRODUCT_NAME} Connect`],
];

/** Upstream also says plain "T3" in prose ("a T3 thread", "the T3 server").
    T3 Chat is another product and keeps its name. */
const BARE_PRODUCT_NAME = /\bT3(?= (?!Code\b|Connect\b|Chat\b)[A-Za-z])/g;

export function rebrandText(text: string): string {
  return PRODUCT_NAME_REPLACEMENTS.reduce(
    (current, [from, to]) => current.replaceAll(from, to),
    text,
  ).replace(BARE_PRODUCT_NAME, GED_PRODUCT_NAME);
}

export function resolveGedProductName(channel: "latest" | "nightly"): string {
  return channel === "nightly" ? `${GED_PRODUCT_NAME} (Nightly)` : GED_PRODUCT_NAME;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rebrandStrings = (value: unknown): unknown => {
  if (typeof value === "string") return rebrandText(value);
  if (Array.isArray(value)) return value.map(rebrandStrings);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, rebrandStrings(v)]));
  }
  return value;
};

/** Upstream's own URL-scheme entry becomes ours; http/https stay as they are. */
const rebrandProtocols = (protocols: unknown): unknown =>
  Array.isArray(protocols)
    ? protocols.map((protocol) =>
        isRecord(protocol) && Array.isArray(protocol.schemes) && protocol.schemes.includes("t3code")
          ? { ...protocol, name: GED_PRODUCT_NAME, schemes: [...GED_URL_SCHEMES] }
          : protocol,
      )
    : protocols;

/** electron-builder config: identity keys, then every user-visible string. */
export function applyGedBuildIdentity(
  config: Json,
  input: { readonly channel: "latest" | "nightly"; readonly version: string },
): Json {
  const productName = resolveGedProductName(input.channel);
  const rebranded = rebrandStrings(config) as Json;
  const mac = isRecord(rebranded.mac)
    ? { ...rebranded.mac, protocols: rebrandProtocols(rebranded.mac.protocols) }
    : rebranded.mac;
  const linux = isRecord(rebranded.linux)
    ? {
        ...rebranded.linux,
        executableName: "gedcode",
        maintainer: `GedCode <${GED_REPOSITORY_URL}>`,
        protocols: rebrandProtocols(rebranded.linux.protocols),
        desktop: { entry: { StartupWMClass: "gedcode" } },
      }
    : rebranded.linux;
  const dmg = isRecord(rebranded.dmg)
    ? { ...rebranded.dmg, title: `${productName} ${input.version} Installer` }
    : rebranded.dmg;
  return {
    ...rebranded,
    appId: GED_APP_ID,
    productName,
    artifactName: "GedCode-${version}-${arch}.${ext}",
    ...(mac === undefined ? {} : { mac }),
    ...(linux === undefined ? {} : { linux }),
    ...(dmg === undefined ? {} : { dmg }),
  };
}

/** The staged app's package.json, including its electron-builder config. */
export function applyGedStagePackageIdentity<T extends { readonly build: Json }>(
  stagePackageJson: T,
  input: { readonly channel: "latest" | "nightly"; readonly version: string },
): T {
  return {
    ...stagePackageJson,
    name: "gedcode",
    description:
      "GedCode is a desktop app for coding agents with durable project memory and an independently verified plan, build and review workflow.",
    homepage: GED_REPOSITORY_URL,
    author: "GedCode",
    build: applyGedBuildIdentity(stagePackageJson.build, input),
  };
}

const TEXT_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".html", ".json", ".webmanifest", ".txt"]);

/**
 * Rewrites the product name in the staged bundles' text files (not their
 * node_modules). Returns the number of files changed.
 */
export const rebrandStagedBundles = Effect.fn("rebrandStagedBundles")(function* (
  directories: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let changed = 0;
  for (const directory of directories) {
    const entries = yield* fs.readDirectory(directory, { recursive: true });
    for (const entry of entries) {
      if (entry.split(path.sep).includes("node_modules")) continue;
      if (!TEXT_EXTENSIONS.has(path.extname(entry))) continue;
      const file = path.join(directory, entry);
      if ((yield* fs.stat(file)).type !== "File") continue;
      const original = yield* fs.readFileString(file);
      const rebranded = rebrandText(original);
      if (rebranded !== original) {
        yield* fs.writeFileString(file, rebranded);
        changed += 1;
      }
    }
  }
  return changed;
});
