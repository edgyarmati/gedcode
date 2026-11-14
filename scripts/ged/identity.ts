import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import ts from "typescript-legacy";

/** Rebrand staged bundles rather than editing upstream's user-visible strings.
    Runtime identity (data directories, URL scheme, app name) must also hold in
    development and is set in source; see `.ged/STANDARDS.md`. */

export const GED_APP_ID = "com.gedcode.app";
export const GED_PRODUCT_NAME = "GedCode";
export const GED_URL_SCHEMES = ["gedcode", "gedcode-dev"] as const;
export const GED_REPOSITORY_URL = "https://github.com/edgyarmati/gedcode";

/** Upstream's product names, most specific first. A stable GedCode is plain
    "GedCode", regardless of upstream's stable stage label. */
const PRODUCT_NAME_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["T3 Code (Beta)", GED_PRODUCT_NAME],
  ["T3 Code (Alpha)", GED_PRODUCT_NAME],
  ["T3 Code (Nightly)", `${GED_PRODUCT_NAME} (Nightly)`],
  ["T3 Code (Dev)", `${GED_PRODUCT_NAME} (Dev)`],
  ["T3 Code", GED_PRODUCT_NAME],
  ["T3 Connect", `${GED_PRODUCT_NAME} Connect`],
];

/** The command the desktop app installs on PATH; upstream calls it `t3`. */
export const GED_CLI_NAME = "gedcode";

const CLI_EXCLUDED_KEYWORDS = "in|of|instanceof|extends|as|from";

/** These ordered text rules must only match prose: exclude keywords after
    identifiers, longer names, members, paths and CSS classes. Remote-host paths,
    unit names and MCP tool names are protocol and must remain unchanged. */
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

function rebrandPrefix(text: string, end: number): string {
  for (const [pattern, to] of [...PRODUCT_NAME_REPLACEMENTS, ...PROSE_RULES]) {
    let delta = 0;
    // Capture groups precede the offset argument; it is the first number.
    const replace = (match: string, ...rest: ReadonlyArray<unknown>): string => {
      const offset = rest.find((value): value is number => typeof value === "number") ?? 0;
      if (offset + match.length > end) return match;
      delta += to.length - match.length;
      return to;
    };
    text =
      typeof pattern === "string"
        ? text.replaceAll(pattern, replace)
        : text.replace(pattern, replace);
    end += delta;
  }
  return text.slice(0, end);
}

export function rebrandText(text: string): string {
  return rebrandPrefix(text, text.length);
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
 * The parse goals each JavaScript file may be loaded with (`true` for module). A `.js` file can be
 * either, as a browser chunk or classic worker as much as under Node, so both readings must agree.
 */
const JAVASCRIPT_GOALS = new Map<string, ReadonlyArray<boolean>>([
  [".mjs", [true]],
  [".cjs", [false]],
  [".js", [false, true]],
]);

/** Strips parentheses and comma sequences, so `(0, require)` resolves to `require`. */
const unwrap = (node: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(node)) return unwrap(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return unwrap(node.right);
  }
  return node;
};

/** The name a callee is reached by: `require`, `x.require` and `x["require"]` all name `require`. */
const nameOf = (node: ts.Expression): string | undefined => {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  if (ts.isElementAccessExpression(target)) {
    const key = unwrap(target.argumentExpression);
    return ts.isStringLiteralLike(key) ? key.text : undefined;
  }
  return undefined;
};

/**
 * Whether calling or constructing `node` loads or resolves a module: `import`, anything named
 * `require`, a `createRequire(...)` result, or any member of those or of `import.meta`. Computed keys
 * are not evaluated. A loader stored under another name, such as `const load = require`, is not
 * followed.
 */
const loadsModules = (node: ts.Expression): boolean => {
  const target = unwrap(node);
  if (target.kind === ts.SyntaxKind.ImportKeyword || nameOf(target) === "require") return true;
  if (ts.isMetaProperty(target)) return target.keywordToken === ts.SyntaxKind.ImportKeyword;
  if (ts.isCallExpression(target)) return nameOf(target.expression) === "createRequire";
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    return loadsModules(target.expression);
  }
  return false;
};

// Sloppy-mode octals are legal in scripts and leave token boundaries intact; Node judges the output.
const TOLERATED_DIAGNOSTICS = new Set([1121, 1487]);

export class StagedBundleParseError extends Schema.TaggedError<StagedBundleParseError>()(
  "StagedBundleParseError",
  { file: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `Cannot rebrand ${this.file}: ${this.reason}`;
  }
}

function rebrandLiterals(source: string, asModule: boolean): string {
  const module = ts.createSourceFile(
    "bundle.js",
    source,
    {
      languageVersion: ts.ScriptTarget.Latest,
      // Otherwise TypeScript guesses the goal from import/export syntax, yet `await /x/g` is a regex
      // only in a module. `externalModuleIndicator` is not in the public typings; unset is a script.
      setExternalModuleIndicator: (file) => {
        if (asModule) (file as { externalModuleIndicator?: true }).externalModuleIndicator = true;
      },
    },
    false,
    ts.ScriptKind.JS,
  );
  // Not in the public typings; a recovered tree would let us rewrite comments as literals.
  const { parseDiagnostics } = module as unknown as {
    readonly parseDiagnostics: ReadonlyArray<ts.Diagnostic>;
  };
  const diagnostic = parseDiagnostics.find(({ code }) => !TOLERATED_DIAGNOSTICS.has(code));
  if (diagnostic !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }
  const parts: string[] = [];
  let offset = 0;
  // An explicit stack in source order: minified `a+b+...` chains nest thousands of nodes deep.
  const stack: Array<{ node: ts.Node; parent?: ts.Node; templateEnd: number | undefined }> = [
    { node: module, templateEnd: undefined },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { node, parent } = next;
    const templateEnd = ts.isTemplateExpression(node) ? node.end : next.templateEnd;
    // Scripts read `<!--` as a line comment, the one Annex B syntax that moves token boundaries;
    // TypeScript reads `a < !--b`. Modules have none, and `-->` already fails TypeScript's parse.
    if (
      !asModule &&
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken &&
      source[node.getStart(module) - 1] === "<" &&
      source.startsWith("!--", node.getStart(module))
    ) {
      throw new Error("`<!--` would be a comment in a script but parses as code");
    }
    const moduleSyntax =
      parent &&
      (ts.isImportDeclaration(parent) ||
        ts.isExportDeclaration(parent) ||
        ts.isImportSpecifier(parent) ||
        ts.isExportSpecifier(parent) ||
        ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
          node === parent.arguments?.[0] &&
          loadsModules(parent.expression)));
    if (moduleSyntax) continue;
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const start = node.getStart(module);
      const original = source.slice(start, node.end);
      // Lookaheads may need the interpolation and following prose, but cannot rewrite them.
      const contextEnd =
        ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? templateEnd : node.end;
      const rebranded = rebrandPrefix(source.slice(start, contextEnd), node.end - start);
      if (original !== rebranded) {
        parts.push(source.slice(offset, start), rebranded);
        offset = node.end;
      }
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => void children.push(child));
    for (const child of children.toReversed())
      stack.push({ node: child, parent: node, templateEnd });
  }
  if (parts.length === 0) return source;
  parts.push(source.slice(offset));
  return parts.join("");
}

function rebrandJavaScript(source: string, goals: ReadonlyArray<boolean>): string {
  const [rebranded = source, ...others] = goals.map((asModule) =>
    rebrandLiterals(source, asModule),
  );
  if (others.some((other) => other !== rebranded)) {
    throw new Error("module and script parses rebrand it differently");
  }
  return rebranded;
}

const isUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether Node accepts `contents` in one of the goals it may be loaded with, which TypeScript's parse
 * cannot promise. Stdin with an explicit `--input-type`: for a `.js` file without a package.json
 * type, `node --check` skips files it detects as modules.
 */
const nodeAccepts = Effect.fn("nodeAccepts")(function* (
  contents: string,
  goals: ReadonlyArray<boolean>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failures: string[] = [];
  for (const asModule of goals) {
    const command = ChildProcess.make(
      process.execPath,
      ["--check", `--input-type=${asModule ? "module" : "commonjs"}`],
      { stdin: Stream.make(new TextEncoder().encode(contents)) },
    );
    const [exitCode, stderr] = yield* Effect.flatMap(spawner.spawn(command), (child) =>
      Effect.all([child.exitCode, Stream.mkString(Stream.decodeText(child.stderr))], {
        concurrency: "unbounded",
      }),
    );
    if (exitCode === 0) return undefined;
    failures.push(stderr.trim());
  }
  return failures.join("\n");
}, Effect.scoped);

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
      const bytes = yield* fs.readFile(file);
      // Keep a byte-order mark; readFileString would drop it.
      const original = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      // Files without the product name are left alone, whatever they contain.
      if (rebrandText(original) === original) continue;
      if (!isUtf8(bytes)) {
        return yield* new StagedBundleParseError({ file, reason: "not valid UTF-8" });
      }
      // Minified identifiers can be T3 or t3; only rewrite JavaScript literal text.
      const goals = JAVASCRIPT_GOALS.get(path.extname(entry));
      const rebranded = goals
        ? yield* Effect.try({
            try: () => rebrandJavaScript(original, goals),
            catch: (cause) =>
              new StagedBundleParseError({
                file,
                reason: cause instanceof Error ? cause.message : String(cause),
              }),
          })
        : rebrandText(original);
      if (rebranded === original) continue;
      const rejection = goals ? yield* nodeAccepts(rebranded, goals) : undefined;
      if (rejection !== undefined) {
        return yield* new StagedBundleParseError({ file, reason: rejection });
      }
      yield* fs.writeFileString(file, rebranded);
      changed += 1;
    }
  }
  return changed;
});
