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

/** The command the desktop app installs on PATH; upstream calls it `t3`. */
export const GED_CLI_NAME = "gedcode";

const CLI_EXCLUDED_KEYWORDS = "in|of|instanceof|extends|as|from";

/**
 * Upstream's other names in prose, applied in order after the product names.
 * Bundles are rewritten as text, so every rule is anchored where it cannot be
 * code: an identifier followed by a space and a word is a syntax error in
 * JavaScript unless the word is a keyword, which the CLI rule excludes, and
 * `T3`/`t3` are never matched as part of a longer name, a member, a path or a
 * CSS class. Remote-host paths, unit names and MCP tool names stay as they are:
 * they are protocol, not prose.
 */
const PROSE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Upstream names one theme after its sister product.
  [/\bT3 Chat\b/g, "Orchid"],
  [/<strong>T3<\/strong> Code/g, `<strong>Ged</strong>Code`],
  // "a T3 thread", "T3's browser", "T3-owned".
  [
    /(?<![\w$.@/[\]-])T3(?= (?!Code\b|Connect\b)[A-Za-z]|'s\b|-(?:owned|managed|injected)\b)/g,
    GED_PRODUCT_NAME,
  ],
  // "outside T3." at the end of a sentence or string.
  [/(?<= )T3(?=[.,;:!?]?(?:["'`\n]|$| (?!-)))/gm, GED_PRODUCT_NAME],
  [/(?<![\w$./-])t3\.json(?![\w(])/g, `${GED_CLI_NAME}.json`],
  [
    /For example, t3 or t3\/ produces t3\/add-search/g,
    "For example, gedcode or gedcode/ produces gedcode/add-search",
  ],
  [/\bRemove t3 from\b/g, `Remove ${GED_CLI_NAME} from`],
  [/\bThis t3 runs\b/g, `This ${GED_PRODUCT_NAME} install runs`],
  [/(?<=["'`])t3(?= \.\/)/g, GED_CLI_NAME],
  [/--transport http t3(?= )/g, `--transport http ${GED_CLI_NAME}`],
  [/\bnpx t3(?:@nightly)?(?=[ "'`\\])/g, GED_CLI_NAME],
  // "t3@1.2.3 is a preview build", but not a package spec ending a template: there is no
  // GedCode package on npm to suggest.
  [/(?<![\w$.@/-])t3@(?=\$\{[\w$.]+\}(?!`)|\d)/g, `${GED_CLI_NAME}@`],
  // "run `t3 update`", "the t3 launcher", "t3 --help".
  [
    new RegExp(
      `(?<![\\w$.@/\\\\-])t3(?= (?!(?:${CLI_EXCLUDED_KEYWORDS})\\b)[A-Za-z]| --[a-z])`,
      "g",
    ),
    GED_CLI_NAME,
  ],
  // "Could not install t3", "as `t3` from", "to run \\`t3\\`".
  [/(?<=[a-z] )(?<!-g )t3(?=["'`])/g, GED_CLI_NAME],
  [/(?<= `)t3(?=`(?: [a-z]|\.))/g, GED_CLI_NAME],
  [/(?<=\\`)t3(?=\\`)/g, GED_CLI_NAME],
];

export function rebrandText(text: string): string {
  const named = PRODUCT_NAME_REPLACEMENTS.reduce(
    (current, [from, to]) => current.replaceAll(from, to),
    text,
  );
  return PROSE_RULES.reduce((current, [pattern, to]) => current.replace(pattern, to), named);
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
