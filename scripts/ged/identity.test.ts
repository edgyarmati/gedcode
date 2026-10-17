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
  productName: "T3 Code (Alpha)",
  artifactName: "T3-Code-${version}-${arch}.${ext}",
  mac: {
    protocols: [{ name: "T3 Code", schemes: ["t3code"] }],
    extendInfo: { NSMicrophoneUsageDescription: "T3 Code uses the microphone for dictation." },
  },
  linux: {
    executableName: "t3code",
    protocols: [{ name: "T3 Code", schemes: ["t3code"] }],
  },
  dmg: { title: "T3 Code (Alpha) 1.0.0 Installer" },
  files: ["!**/*.map"],
};

describe("GedCode identity", () => {
  it("rewrites the most specific product name first", () => {
    assert.equal(rebrandText("Restart T3 Code (Alpha) now"), "Restart GedCode now");
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

  it.effect("rewrites staged text bundles but leaves node_modules and binaries alone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(path.join(root, "client/assets"), { recursive: true });
      yield* fs.makeDirectory(path.join(root, "node_modules/dep"), { recursive: true });
      yield* fs.writeFileString(path.join(root, "client/index.html"), "<title>T3 Code</title>");
      yield* fs.writeFileString(path.join(root, "client/assets/app.js"), 'n="T3 Code (Alpha)"');
      yield* fs.writeFileString(path.join(root, "client/assets/plain.js"), "no product name");
      yield* fs.writeFileString(path.join(root, "client/assets/logo.png"), "T3 Code");
      yield* fs.writeFileString(path.join(root, "node_modules/dep/index.js"), "T3 Code");

      const changed = yield* rebrandStagedBundles([root]);

      assert.equal(changed, 2);
      assert.equal(
        yield* fs.readFileString(path.join(root, "client/index.html")),
        "<title>GedCode</title>",
      );
      assert.equal(
        yield* fs.readFileString(path.join(root, "client/assets/app.js")),
        'n="GedCode"',
      );
      assert.equal(yield* fs.readFileString(path.join(root, "client/assets/logo.png")), "T3 Code");
      assert.equal(
        yield* fs.readFileString(path.join(root, "node_modules/dep/index.js")),
        "T3 Code",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
