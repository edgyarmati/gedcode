import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { expect } from "vitest";

import manifest from "../package.json" with { type: "json" };
import baseConfig from "../tsconfig.base.json" with { type: "json" };
import lintConfig from "../.oxlintrc.json" with { type: "json" };
import diagnosticPolicy from "./compiler-diagnostic-policy.json" with { type: "json" };
import { parse as parseJsonc } from "jsonc-parser";

const Manifest = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.Record(Schema.String, Schema.String) }),
);
const decodeManifest = Schema.decodeEffect(Manifest);
const decodeExecutablePaths = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ host: Schema.String, replacement: Schema.String })),
);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeConfig = Schema.decodeUnknownEffect(
  Schema.Struct({
    extends: Schema.String,
    compilerOptions: Schema.Struct({ plugins: Schema.optional(Schema.Array(Schema.Unknown)) }),
  }),
);
const workspaceDirectories = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "..");
  const directories: string[] = [];
  for (const pattern of manifest.workspaces.packages) {
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2);
      for (const child of yield* fs.readDirectory(path.join(root, parent))) {
        if (yield* fs.exists(path.join(root, parent, child, "package.json")))
          directories.push(`${parent}/${child}`);
      }
    } else {
      expect(pattern).not.toContain("*");
      directories.push(pattern);
    }
  }
  return directories.toSorted();
});

const runCommand = Effect.fn("runCommand")(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  stdin?: string,
) {
  const handle = yield* ChildProcess.make(command, args, {
    cwd,
    ...(stdin === undefined ? {} : { stdin: Stream.make(new TextEncoder().encode(stdin)) }),
  });
  return yield* Effect.all(
    {
      exitCode: handle.exitCode,
      stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
      stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
    },
    { concurrency: "unbounded" },
  );
});

// Use the installed host's entry point, never a downloaded or substitute compiler.
const compiler = Effect.fn("compiler")(function* (args: ReadonlyArray<string>) {
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "..");
  return yield* runCommand(
    process.execPath,
    [path.join(root, "node_modules/typescript/bin/tsc"), ...args],
    root,
  );
});

const probe = Effect.fn("probe")(function* (config: string, source: string, format = false) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "..");
  // Scoped fixtures resolve the real workspace dependencies and are always removed.
  const directory = yield* fs.makeTempDirectoryScoped({
    directory: path.join(path.dirname(path.join(root, config)), "node_modules"),
    prefix: "ged-compiler-probe-",
  });
  yield* fs.writeFileString(path.join(directory, "probe.mts"), source);
  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    yield* encodeJson({
      extends: path.join(root, config),
      files: ["probe.mts", "effect-consumer.mts"],
      include: [],
    }),
  );
  yield* fs.writeFileString(
    path.join(directory, "effect-consumer.mts"),
    'import * as Effect from "effect/Effect"; import "./probe.mts"; export const loaded = Effect.void;',
  );
  if (format) {
    const result = yield* runCommand(
      "bun",
      ["run", "fmt", "--stdin-filepath", path.join(directory, "probe.mts")],
      root,
      source,
    );
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    yield* fs.writeFileString(path.join(directory, "probe.mts"), result.stdout);
  }
  const result = yield* compiler(["--project", path.join(directory, "tsconfig.json"), "--noEmit"]);
  return { ...result, source: yield* fs.readFileString(path.join(directory, "probe.mts")) };
});

it.layer(NodeServices.layer)("supported patched compiler", (it) => {
  it.effect("aligns the host, patch hook and every workspace typecheck without relaxed flags", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "..");
      expect(manifest.workspaces.catalog.typescript).toBe("7.0.2");
      expect(manifest.workspaces.catalog["@effect/tsgo"]).toBe("0.43.0");
      expect(manifest.devDependencies.typescript).toBe("catalog:");
      expect(manifest.devDependencies).not.toHaveProperty("@typescript/native-preview");
      expect(manifest.scripts.prepare).toBe("effect-tsgo patch --typescript");
      expect(manifest.scripts.typecheck).toBe("turbo run typecheck --concurrency=1");
      for (const directory of yield* workspaceDirectories) {
        const workspace = yield* fs
          .readFileString(path.join(root, directory, "package.json"))
          .pipe(Effect.flatMap(decodeManifest));
        expect(workspace.scripts.typecheck, directory).toBe("tsc --noEmit");
        const actualRunner = yield* runCommand(
          "bun",
          ["run", "typecheck", "--version"],
          path.join(root, directory),
        );
        expect(actualRunner.exitCode, directory + actualRunner.stdout + actualRunner.stderr).toBe(
          0,
        );
        expect(actualRunner.stdout.trim(), directory).toBe("Version 7.0.2+effect-tsgo.0.43.0");
        const config = yield* fs
          .readFileString(path.join(root, directory, "tsconfig.json"))
          .pipe(Effect.flatMap((text) => decodeConfig(parseJsonc(text))));
        expect(path.resolve(root, directory, config.extends), directory).toBe(
          path.join(root, "tsconfig.base.json"),
        );
        expect(config.compilerOptions.plugins ?? [], directory).toEqual(
          directory === "apps/web" ? diagnosticPolicy.web : [],
        );
      }
      const result = yield* compiler(["--version"]);
      expect(result.stderr).toBe("");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("Version 7.0.2+effect-tsgo.0.43.0");
    }),
  );

  it.effect("keeps standard TypeScript errors release-blocking", () =>
    Effect.gen(function* () {
      const result = yield* probe("tsconfig.base.json", "export const value: string = 1;");
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain("error TS2322");
      expect(result.stderr).toBe("");
    }),
  );

  it.effect("enforces the base Effect severity and fails the actual compiler exit code", () =>
    Effect.gen(function* () {
      expect(baseConfig.compilerOptions.plugins[0]?.diagnosticSeverity.globalRandom).toBe("error");
      const result = yield* probe("tsconfig.base.json", "export const value = Math.random();");
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain("error TS377");
      expect(result.stdout).toContain("effect(globalRandom)");
      expect(result.stderr).toBe("");
    }),
  );

  it.effect("keeps the existing web-only allowance for randomness outside Effect", () =>
    Effect.gen(function* () {
      const result = yield* probe("apps/web/tsconfig.json", "export const value = Math.random();");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    }),
  );

  it.effect("deep-merges inherited Effect errors through the web overrides", () =>
    Effect.gen(function* () {
      const result = yield* probe(
        "apps/web/tsconfig.json",
        'import * as Effect from "effect/Effect"; export const value = Effect.gen(function* () { yield* Effect.void; return Math.random(); });',
      );
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain("effect(globalRandomInEffect)");
      expect(result.stdout).not.toContain("effect(globalRandom)");
      expect(result.stderr).toBe("");
    }),
  );
  it.effect("freezes diagnostic configuration and error-level lint boundary", () =>
    Effect.sync(() => {
      expect(baseConfig.compilerOptions.plugins).toEqual(diagnosticPolicy.base);
      expect(lintConfig).toEqual(diagnosticPolicy.lint);
      expect(baseConfig.compilerOptions.plugins[0]?.diagnosticSeverity.nodeBuiltinImport).toBe(
        "error",
      );
      expect(lintConfig.rules["t3code/native-crypto-boundary"]).toBe("error");
    }),
  );

  it.effect(
    "checks the installed native host against the packaged Effect replacement byte for byte",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.resolve(import.meta.dirname, "..");
        const result = yield* runCommand(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import host from "./node_modules/typescript/lib/getExePath.js";
             import { createRequire } from "node:module";
             import { fileURLToPath, pathToFileURL } from "node:url";
             const resolve = createRequire(import.meta.resolve("@effect/tsgo/package.json")).resolve;
             const pkg = pathToFileURL(resolve("@effect/tsgo-" + process.platform + "-" + process.arch + "/package.json"));
             const replacement = fileURLToPath(new URL("./artifacts/typescript/7.0.2/tsc" + (process.platform === "win32" ? ".exe" : ""), pkg));
             process.stdout.write(JSON.stringify({host: host(), replacement}));`,
          ],
          root,
        );
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const paths = yield* decodeExecutablePaths(result.stdout);
        const host = yield* fs.readFile(paths.host);
        const replacement = yield* fs.readFile(paths.replacement);
        expect(host.byteLength).toBeGreaterThan(1_000_000);
        expect(Buffer.from(host).equals(Buffer.from(replacement))).toBe(true);
      }),
  );

  const nativeDirective = ["// @effect", "diagnostics-next-line nodeBuiltinImport:off"].join("-");
  const cryptoImport = 'import { createHmac, timingSafeEqual } from "node:crypto";';
  for (const fixture of [
    {
      name: "unexcepted crypto",
      source: cryptoImport,
      diagnostic: "effect(nodeBuiltinImport)",
      exit: 1,
    },
    {
      name: "exact next-line crypto exception",
      source: `${nativeDirective}\n${cryptoImport}`,
      diagnostic: "",
      exit: 0,
    },
    {
      name: "neighboring filesystem import",
      source: `${nativeDirective}\n${cryptoImport}\nimport * as Fs from "node:fs";`,
      diagnostic: "effect(nodeBuiltinImport)",
      exit: 1,
    },
    {
      name: "ordinary TS error beside exception",
      source: `${nativeDirective}\n${cryptoImport}\nexport const value: string = 1;`,
      diagnostic: "error TS2322",
      exit: 1,
    },
    {
      name: "another Effect error beside exception",
      source: `${nativeDirective}\n${cryptoImport}\nexport const value = Math.random();`,
      diagnostic: "effect(globalRandom)",
      exit: 1,
    },
    {
      name: "misplaced multiline directive",
      source: `${nativeDirective}\nimport {\ncreateHmac, timingSafeEqual\n} from "node:crypto";`,
      diagnostic: "effect(nodeBuiltinImport)",
      exit: 1,
    },
  ]) {
    it.effect(`loads Effect and enforces ${fixture.name}`, () =>
      Effect.gen(function* () {
        const result = yield* probe("packages/shared/tsconfig.json", fixture.source);
        expect(result.exitCode, result.stdout + result.stderr).toBe(fixture.exit);
        expect(result.stderr).toBe("");
        if (fixture.diagnostic) expect(result.stdout).toContain(fixture.diagnostic);
        else expect(result.stdout).toBe("");
        if (fixture.name === "neighboring filesystem import") {
          expect(result.stdout).toContain("probe.mts(3,");
          expect(result.stdout.match(/effect\(nodeBuiltinImport\)/g)).toHaveLength(1);
        }
      }),
    );
  }

  it.effect("honors only the module line after actual multiline formatting", () =>
    Effect.gen(function* () {
      const result = yield* probe(
        "packages/shared/tsconfig.json",
        `import {
      createHmac as createNativeHmacForAuthentication,
      timingSafeEqual as compareNativeSignatureBytes,
      ${nativeDirective}
    } from "node:crypto";`,
        true,
      );
      expect(result.source).toContain(`${nativeDirective}\n} from "node:crypto";`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toBe("");
      const neighbor = yield* probe(
        "packages/shared/tsconfig.json",
        `${result.source}\nimport * as Fs from "node:fs";`,
        true,
      );
      expect(neighbor.exitCode, neighbor.stdout + neighbor.stderr).toBe(1);
      expect(neighbor.stdout.match(/effect\(nodeBuiltinImport\)/g)).toHaveLength(1);
    }),
  );
});
