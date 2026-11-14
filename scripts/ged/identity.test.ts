// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  GED_APP_ID,
  applyGedBuildIdentity,
  applyGedStagePackageIdentity,
  rebrandStagedBundles,
  rebrandText,
} from "./identity.ts";

/** The parts of upstream's electron-builder config the identity overlay touches. */
const upstreamBuildConfig = {
  appId: "com.t3tools.t3code",
  productName: "T3 Code (Beta)",
  artifactName: "T3-Code-${version}-${arch}.${ext}",
  mac: {
    protocols: [{ name: "T3 Code", schemes: ["t3code"] }],
    extendInfo: { NSMicrophoneUsageDescription: "T3 Code uses the microphone for dictation." },
  },
  linux: {
    executableName: "t3code",
    protocols: [{ name: "T3 Code", schemes: ["t3code"] }],
  },
  dmg: { title: "T3 Code (Beta) 1.0.0 Installer" },
  files: ["!**/*.map"],
};

describe("GedCode identity", () => {
  it("rewrites the most specific product name first", () => {
    assert.equal(rebrandText("Restart T3 Code (Alpha) now"), "Restart GedCode now");
    assert.equal(rebrandText("Restart T3 Code (Beta) now"), "Restart GedCode now");
    assert.equal(rebrandText("T3 Code (Nightly)"), "GedCode (Nightly)");
    assert.equal(rebrandText("Sign in to T3 Connect"), "Sign in to GedCode Connect");
    assert.equal(rebrandText("the T3 Code desktop app"), "the GedCode desktop app");
  });

  it("rewrites plain T3 in prose, but not identifiers", () => {
    assert.equal(rebrandText("Read a T3 thread"), "Read a GedCode thread");
    assert.equal(rebrandText("the T3 server restarted"), "the GedCode server restarted");
    assert.equal(rebrandText("in T3's browser"), "in GedCode's browser");
    assert.equal(rebrandText("a T3-owned task"), "a GedCode-owned task");
    assert.equal(rebrandText("rewound outside T3."), "rewound outside GedCode.");
    assert.equal(rebrandText("label:`T3 Chat`"), "label:`Orchid`");
    for (const code of [
      "T3CODE_HOME",
      "return T3(e,t)",
      ";T3(f,{scopeElement:o})",
      "[T3.Env]::Send",
      "-Namespace T3 -Name Env",
      "T3_LOCK",
    ]) {
      assert.equal(rebrandText(code), code);
    }
  });

  it("names the CLI and project file gedcode in prose, but not in code", () => {
    assert.equal(rebrandText("Run `t3 service install`."), "Run `gedcode service install`.");
    assert.equal(rebrandText('"Could not install t3"'), '"Could not install gedcode"');
    assert.equal(rebrandText("title:`Could not remove t3`"), "title:`Could not remove gedcode`");
    assert.equal(rebrandText("`npm uninstall -g t3`"), "`npm uninstall -g t3`");
    assert.equal(
      rebrandText("This t3 runs from a Node script"),
      "This GedCode install runs from a Node script",
    );
    assert.equal(rebrandText('such as "t3 ./my-project"'), 'such as "gedcode ./my-project"');
    assert.equal(rebrandText("the t3 launcher"), "the gedcode launcher");
    assert.equal(rebrandText('Use "t3 --help"'), 'Use "gedcode --help"');
    assert.equal(
      rebrandText("CLI as `t3` from any terminal"),
      "CLI as `gedcode` from any terminal",
    );
    assert.equal(rebrandText("to run \\`t3\\`."), "to run \\`gedcode\\`.");
    assert.equal(
      rebrandText("command:`sudo npx t3 browser setup`"),
      "command:`sudo gedcode browser setup`",
    );
    assert.equal(
      rebrandText("`t3@${v} is a preview build.`"),
      "`gedcode@${v} is a preview build.`",
    );
    assert.equal(rebrandText("Import from t3.json"), "Import from gedcode.json");
    assert.equal(
      rebrandText("For example, t3 or t3/ produces t3/add-search."),
      "For example, gedcode or gedcode/ produces gedcode/add-search.",
    );
    for (const code of [
      "return t3 in x",
      "for (const t3 of xs)",
      "class t3 extends Base",
      "export { t3 as name }",
      'import t3 from "t3"',
      "t3.json()",
      "foo.t3.json",
      'credentialOwner: "t3"',
      "t3-file-icon",
      "t3_write_pty",
      "@t3tools/shared",
      "$HOME/.t3/bin/t3",
      "refs/t3/checkpoints",
      "`${runner} t3@${version}`",
      "npm install -g t3",
      '"npm install -g t3"',
      "https://t3.chat",
    ]) {
      assert.equal(rebrandText(code), code);
    }
  });

  it("rewrites the dev name, the wordmark and the CLI in commands", () => {
    assert.equal(rebrandText("T3 Code (Dev)"), "GedCode (Dev)");
    assert.equal(rebrandText("<strong>T3</strong> Code"), "<strong>Ged</strong>Code");
    assert.equal(rebrandText("Remove t3 from PATH"), "Remove gedcode from PATH");
    assert.equal(
      rebrandText("claude mcp add --transport http t3 http://localhost"),
      "claude mcp add --transport http gedcode http://localhost",
    );
  });

  it("gives the build GedCode's bundle identity, names and URL schemes", () => {
    const config = applyGedBuildIdentity(upstreamBuildConfig, {
      channel: "latest",
      version: "0.5.0",
    });

    assert.equal(config.appId, GED_APP_ID);
    assert.equal(config.productName, "GedCode");
    assert.equal(config.artifactName, "GedCode-${version}-${arch}.${ext}");
    assert.deepEqual(config.mac, {
      protocols: [{ name: "GedCode", schemes: ["gedcode", "gedcode-dev"] }],
      extendInfo: { NSMicrophoneUsageDescription: "GedCode uses the microphone for dictation." },
    });
    assert.deepEqual(config.dmg, { title: "GedCode 0.5.0 Installer" });
    assert.deepEqual(config.files, ["!**/*.map"]);
    assert.notInclude(JSON.stringify(config), "T3 Code");
  });

  it("names nightly builds as nightly", () => {
    const config = applyGedBuildIdentity(upstreamBuildConfig, {
      channel: "nightly",
      version: "0.5.0-nightly.20261011.1",
    });
    assert.equal(config.productName, "GedCode (Nightly)");
    assert.equal(config.appId, GED_APP_ID);
  });

  it("rebrands the staged package and its build config together", () => {
    const stage = applyGedStagePackageIdentity(
      { name: "t3code", version: "0.5.0", author: "T3 Tools", build: upstreamBuildConfig },
      { channel: "latest", version: "0.5.0" },
    );
    assert.equal(stage.name, "gedcode");
    assert.equal(stage.version, "0.5.0");
    assert.equal(stage.author, "GedCode");
    assert.equal(stage.build.appId, GED_APP_ID);
  });

  it.effect(
    "rebrands staged text without changing JavaScript syntax, dependencies or binaries",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(root, "client/assets"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "node_modules/dep"), { recursive: true });
        yield* fs.writeFileString(path.join(root, "client/index.html"), "<title>T3 Code</title>");
        const javascript = [
          'import {"T3 Code" as imported} from "./T3 Code.mjs";',
          'export {imported as "T3 Code"};',
          'export const load=()=>import(`./T3 Code${""}.mjs`);',
          'export const required=()=>require("./T3 Code.cjs");',
          'export const resolved=()=>require.resolve(`./T3 Code${""}.cjs`);',
          'export const wrapped=()=>[(require)("./T3 Code.cjs"),(require.resolve)("./T3 Code.cjs")];',
          'export const computed=()=>[(require)["resolve"]("./T3 Code.cjs"),require[("resolve")]("./T3 Code.cjs")];',
          'export const sequenced=()=>[(0,require)("./T3 Code.cjs"),(0,require.resolve)("./T3 Code.cjs"),(0,(0,require))["resolve"]("./T3 Code.cjs")];',
          'export const announced=()=>(globalThis.shown="T3 Code",require)("node:path");',
          'const T3="ArrowRight",t3=2;',
          "export {T3 as si,t3 as cli};",
          'export const name="T3 Code (Beta)";',
          'export const label=`T3 Code: ${T3}; T3 server ${"T3 thread"}; T3 browser`;',
          'const version="0.6.0";',
          "export const preview=`t3@${version} is a preview build.`;",
          "export const matcher=/T3 as t3/;",
          "// T3 Code: T3 as t3",
        ].join("\n");
        for (const extension of ["js", "cjs", "mjs"]) {
          yield* fs.writeFileString(path.join(root, `client/assets/app.${extension}`), javascript);
        }
        yield* fs.writeFileString(
          path.join(root, "client/assets/T3 Code.mjs"),
          'const value=7;export {value as "T3 Code"};',
        );
        yield* fs.writeFileString(
          path.join(root, "client/assets/plain.js"),
          'export const plain="no product name";',
        );
        yield* fs.writeFileString(
          path.join(root, "client/assets/bom.js"),
          '\uFEFFexport const bom="T3 Code";',
        );
        yield* fs.writeFileString(path.join(root, "client/assets/logo.png"), "T3 Code");
        yield* fs.writeFileString(path.join(root, "node_modules/dep/index.js"), "T3 Code");

        const changed = yield* rebrandStagedBundles([root]);

        assert.equal(changed, 5);
        assert.equal(
          yield* fs.readFileString(path.join(root, "client/index.html")),
          "<title>GedCode</title>",
        );
        for (const extension of ["js", "cjs", "mjs"]) {
          assert.equal(
            yield* fs.readFileString(path.join(root, `client/assets/app.${extension}`)),
            javascript
              .replace('name="T3 Code (Beta)"', 'name="GedCode"')
              .replace('shown="T3 Code"', 'shown="GedCode"')
              .replace("label=`T3 Code:", "label=`GedCode:")
              .replace("; T3 server", "; GedCode server")
              .replace('"T3 thread"', '"GedCode thread"')
              .replace("preview=`t3@", "preview=`gedcode@")
              .replace("; T3 browser`", "; GedCode browser`"),
          );
        }
        const module = yield* Effect.promise(
          () => import(NodeURL.pathToFileURL(path.join(root, "client/assets/app.mjs")).href),
        );
        assert.equal(module.si, "ArrowRight");
        assert.equal(module.cli, 2);
        assert.equal(module.name, "GedCode");
        assert.equal(module["T3 Code"], 7);
        const loaded = yield* Effect.promise(() => module.load());
        assert.propertyVal(loaded, "T3 Code", 7);
        assert.equal(module.preview, "gedcode@0.6.0 is a preview build.");
        assert.equal(
          module.label,
          "GedCode: ArrowRight; GedCode server GedCode thread; GedCode browser",
        );
        assert.deepEqual(
          [...(yield* fs.readFile(path.join(root, "client/assets/bom.js")))],
          [...new TextEncoder().encode('\uFEFFexport const bom="GedCode";')],
        );
        assert.equal(
          yield* fs.readFileString(path.join(root, "client/assets/logo.png")),
          "T3 Code",
        );
        assert.equal(
          yield* fs.readFileString(path.join(root, "node_modules/dep/index.js")),
          "T3 Code",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses to rebrand JavaScript it cannot parse", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // Annex B HTML comments are valid script syntax the parser does not support.
      for (const source of [
        'const name="T3 Code";\n<!-- "T3 Code"\n',
        "const =;",
        'const name="T3 Code";const pattern=/(/;',
      ]) {
        const root = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(path.join(root, "legacy.cjs"), source);

        const error = yield* Effect.flip(rebrandStagedBundles([root]));

        assert.include(String(error), "legacy.cjs");
        assert.equal(yield* fs.readFileString(path.join(root, "legacy.cjs")), source);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
