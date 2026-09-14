import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const directive = ["// @effect", "diagnostics-next-line nodeBuiltinImport:off"].join("-");
const broad = directive.replace("-next-line", "");
const legacy = createOxlintRuleHarness(
  "t3code/native-crypto-boundary",
  "scripts/audit-production-dependencies.test.ts",
);
const approvedPath = "apps/server/src/auth/utils.ts";
const rule = createOxlintRuleHarness("t3code/native-crypto-boundary", approvedPath);
const outside = createOxlintRuleHarness("t3code/native-crypto-boundary");
const named = createOxlintRuleHarness(
  "t3code/native-crypto-boundary",
  "apps/server/src/attachmentStore.ts",
);
const body = `
Crypto.createHmac("sha256", new Uint8Array(32));
Crypto.timingSafeEqual(new Uint8Array(32), new Uint8Array(32));`;
const valid = `${directive}\nimport * as Crypto from "node:crypto";${body}`;

describe("reviewed native crypto boundary (actual Oxlint parser and scopes)", () => {
  for (const code of [
    'const p = (process satisfies typeof process); p.getBuiltinModule("crypto");',
    'const { process: p } = globalThis; p.getBuiltinModule("crypto");',
    'const root = globalThis; const { process: p } = root; p.getBuiltinModule("crypto");',
    'const { process: p = process } = globalThis; p.getBuiltinModule("crypto");',
    'const { globalThis: { process: p } } = globalThis; p.getBuiltinModule("crypto");',
    'const { ["process"]: p } = globalThis; p.getBuiltinModule("crypto");',
    'const { process: p } = globalThis; function f(process) { p.getBuiltinModule("crypto"); }',
  ])
    outside.invalid(`tracks transparent wrappers and global destructuring: ${code}`, code);
  for (const code of [
    'function f(process) { const p = (process satisfies typeof process); p.getBuiltinModule("crypto"); }',
    'function f(globalThis) { const { process: p } = globalThis; p.getBuiltinModule("crypto"); }',
    'const { process: p } = globalThis; function f(p) { p.getBuiltinModule("crypto"); } p.cwd();',
    "const { process: p } = globalThis; p.cwd();",
    'const { process: p } = { process: { getBuiltinModule: (name) => name } }; p.getBuiltinModule("crypto");',
  ])
    outside.valid(`preserves shadowing and benign destructuring: ${code}`, code);
  outside.invalid(
    "review blocker: rejects aliased process loader",
    'const proc = process; proc.getBuiltinModule("crypto");',
  );
  outside.invalid(
    "review blocker: rejects globalThis process loader",
    'globalThis.process.getBuiltinModule("crypto");',
  );
  outside.invalid(
    "review blocker: rejects imported process loader",
    'import { getBuiltinModule } from "node:process"; getBuiltinModule("crypto");',
  );
  legacy.invalid(
    "review blocker: rejects bare builtin under frozen legacy exception",
    `${broad}\nimport { readFileSync } from "fs"; readFileSync("fixture");`,
    (output) => assert.include(output, "native imports under a legacy broad exception changed"),
  );
  for (const [name, code] of [
    [
      "bare named process loader import",
      'import { getBuiltinModule as load } from "process"; load("crypto");',
    ],
    [
      "renamed process loader import",
      'import { getBuiltinModule as load } from "node:process"; const other = load; other("crypto");',
    ],
    ["default process import", 'import proc from "node:process"; proc.getBuiltinModule("crypto");'],
    [
      "bare namespace process import",
      'import * as proc from "process"; proc.getBuiltinModule("crypto");',
    ],
    [
      "named default process import",
      'import { default as proc } from "node:process"; proc.getBuiltinModule("crypto");',
    ],
    [
      "imported process alias chain",
      'import proc from "process"; const p = (proc as typeof proc); const q = p; q.getBuiltinModule("crypto");',
    ],
    [
      "nested process alias",
      'const proc = process; function load() { return proc.getBuiltinModule("crypto"); }',
    ],
    [
      "wrapped process alias",
      'const proc = (process as typeof process)!; proc.getBuiltinModule("crypto");',
    ],
    [
      "globalThis alias chain",
      'const root = globalThis; const proc = root.process; proc.getBuiltinModule("crypto");',
    ],
    ["literal globalThis property", 'globalThis["process"].getBuiltinModule("crypto");'],
    [
      "computed aliased process loader",
      'const proc = process; proc["get" + "BuiltinModule"]("crypto");',
    ],
    [
      "destructured imported process",
      'import proc from "node:process"; const { getBuiltinModule: load } = proc; load("crypto");',
    ],
    [
      "destructured globalThis process",
      'const { getBuiltinModule: load } = globalThis.process; load("crypto");',
    ],
    [
      "detached globalThis process loader",
      'const load = globalThis.process.getBuiltinModule; load("crypto");',
    ],
    ["aliased binding API", 'const proc = process; proc.binding("crypto");'],
    [
      "imported linked binding API",
      'import { _linkedBinding as load } from "node:process"; load("crypto");',
    ],
    [
      "noncrypto alternate loader still forbidden",
      'const proc = process; proc.getBuiltinModule("fs");',
    ],
    [
      "global loader outside a shadowed block",
      'function f(process) { return process.getBuiltinModule("crypto"); } process.getBuiltinModule("crypto");',
    ],
    ["aliased module require", 'const mod = module; mod.require("crypto");'],
    ["globalThis module require", 'globalThis.module.require("crypto");'],
    [
      "destructured module alias",
      'const mod = module; const { require: load } = mod; load("crypto");',
    ],
  ] as const) {
    outside.invalid(`rejects ${name}`, code);
  }
  for (const [name, code] of [
    [
      "process parameter shadow",
      'function f(process) { return process.getBuiltinModule("crypto"); }',
    ],
    [
      "local process object",
      'const process = { getBuiltinModule: (name) => name }; process.getBuiltinModule("crypto");',
    ],
    [
      "aliased local process object",
      'const process = { getBuiltinModule: (name) => name }; const proc = process; proc.getBuiltinModule("crypto");',
    ],
    [
      "unrelated process import",
      'import process from "other-package"; process.getBuiltinModule("crypto");',
    ],
    [
      "unrelated named loader import",
      'import { getBuiltinModule } from "other-package"; getBuiltinModule("crypto");',
    ],
    [
      "globalThis parameter shadow",
      'function f(globalThis) { return globalThis.process.getBuiltinModule("crypto"); }',
    ],
    [
      "shadowed imported process alias",
      'import proc from "node:process"; function f(proc) { return proc.getBuiltinModule("crypto"); } proc.cwd();',
    ],
    [
      "shadowed global alias",
      'const proc = process; function f(proc) { return proc.getBuiltinModule("crypto"); } proc.cwd();',
    ],
    ["local computed process", 'function f(process, key) { return process[key]("crypto"); }'],
    [
      "local destructured process",
      'function f(process) { const { getBuiltinModule } = process; return getBuiltinModule("crypto"); }',
    ],
    ["require parameter shadow", 'function f(require) { return require("crypto"); }'],
    ["module parameter shadow", 'function f(module) { return module.require("crypto"); }'],
    [
      "local destructured module",
      'function f(module) { const { require } = module; return require("crypto"); }',
    ],
    ["ordinary global process API", "const proc = process; proc.cwd(); globalThis.process.env;"],
    [
      "ordinary imported process APIs",
      'import proc, { cwd as current } from "node:process"; proc.cwd(); current();',
    ],
    ["ordinary namespace process API", 'import * as proc from "process"; proc.cwd();'],
    ["noncrypto literal require", 'require("fs");'],
    [
      "noncrypto createRequire",
      'import { createRequire as make } from "node:module"; const load = make(import.meta.url); load("fs");',
    ],
    [
      "cyclic nonnative aliases terminate",
      'const first = second; const second = first; first.getBuiltinModule("crypto");',
    ],
  ] as const) {
    outside.valid(`allows ${name}`, code);
  }
  for (const module of [
    "node:fs",
    "fs/promises",
    "path",
    "stream/web",
    "assert/strict",
    "node:test",
  ]) {
    legacy.invalid(
      `rejects new builtin ${module} under frozen legacy exception`,
      `${broad}\nimport * as Native from "${module}";`,
      (output) => assert.include(output, "native imports under a legacy broad exception changed"),
    );
  }
  legacy.valid("allows unchanged empty legacy native inventory", broad);
  legacy.valid(
    "does not classify builtin-like packages or relative paths as native",
    `${broad}\nimport "fs-extra"; import "./fs"; import "@scope/fs"; import "test";`,
  );
  rule.valid("allows exact namespace and operations", valid);
  rule.valid(
    "allows directive before formatted multiline module line",
    `import * as Crypto from\n${directive}\n"node:crypto";${body}`,
  );
  outside.valid(
    "does not reinterpret text in strings as comments/imports",
    `const fixture = ${JSON.stringify(valid)};`,
  );
  rule.invalid("rejects an unauthorized namespace operation", `${valid}\nCrypto.randomBytes(32);`);
  rule.invalid(
    "rejects removing an operation",
    valid.replace('Crypto.createHmac("sha256", new Uint8Array(32));', ""),
  );
  rule.invalid("rejects namespace escape", `${valid}\nconst other = Crypto;`);
  rule.invalid("rejects destructuring escape", `${valid}\nconst { randomBytes } = Crypto;`);
  rule.invalid(
    "rejects computed namespace operation",
    valid.replace("Crypto.createHmac", 'Crypto["createHmac"]'),
  );
  rule.invalid("rejects wrapped operation alias", `${valid}\nconst other = (Crypto as unknown);`);
  rule.invalid("rejects detached function", `${valid}\nconst other = Crypto.createHmac;`);
  rule.invalid("rejects reexporting a binding", `${valid}\nexport { Crypto };`);
  rule.invalid(
    "rejects expanded import",
    valid.replace("* as Crypto", "{ createHmac, timingSafeEqual, randomBytes }"),
  );
  rule.invalid("rejects default imports", valid.replace("* as Crypto", "Crypto"));
  rule.invalid("rejects type-only imports", valid.replace("import *", "import type *"));
  rule.invalid("rejects renamed bindings", valid.replaceAll("Crypto", "Other"));
  rule.invalid("rejects bare module spelling", valid.replace('"node:crypto"', '"crypto"'));
  rule.invalid(
    "rejects escaped module spelling",
    valid.replace('"node:crypto"', '"node:\\u0063rypto"'),
  );
  rule.invalid("rejects replacement with filesystem", valid.replace("node:crypto", "node:fs"));
  rule.invalid(
    "rejects copied exception within approved file",
    `${valid}\n${directive}\nimport * as Fs from "node:fs";`,
  );
  rule.invalid(
    "rejects a blank line after directive",
    valid.replace(`${directive}\n`, `${directive}\n\n`),
  );
  rule.invalid(
    "rejects multiline directive before import start",
    `${directive}\nimport * as Crypto\nfrom "node:crypto";${body}`,
  );
  rule.invalid(
    "rejects shared diagnostic line",
    valid.replace(";\nCrypto", '; import * as Fs from "node:fs";\nCrypto'),
  );
  rule.invalid(
    "rejects extra directive rule",
    valid.replace("nodeBuiltinImport:off", "nodeBuiltinImport:off globalRandom:off"),
  );
  rule.invalid("rejects broad exception", valid.replace(directive, broad));
  rule.invalid(
    "rejects block comment exception",
    valid.replace(directive, `/* ${directive.slice(3)} */`),
  );
  rule.invalid("rejects TS blanket suppression", `// @ts-nocheck\n${valid}`);
  outside.invalid("rejects moved/copy exception at another file", valid);
  outside.invalid("rejects nested path spoof", valid);
  outside.invalid("rejects unexcepted import", 'import { createHash } from "node:crypto";');
  outside.invalid("rejects side-effect import", 'import "node:crypto";');
  outside.invalid("rejects named reexport", 'export { createHash } from "node:crypto";');
  outside.invalid("rejects star reexport", 'export * from "crypto";');
  outside.invalid("rejects dynamic import", 'const crypto = import("node:crypto");');
  outside.invalid("rejects computed dynamic import", 'const crypto = import("node:" + "crypto");');
  outside.invalid(
    "rejects indirect dynamic import",
    'const name = "node:crypto"; const crypto = import(name);',
  );
  outside.invalid("rejects template dynamic import", "const crypto = import(`node:crypto`);");
  outside.invalid("rejects require", 'const crypto = require("crypto");');
  outside.invalid(
    "rejects nested/escaped require",
    'function load() { return require("node:\\u0063rypto"); }',
  );
  outside.invalid("rejects computed require", 'const crypto = require("node:" + "crypto");');
  outside.invalid("rejects import equals", 'import crypto = require("node:crypto");');
  outside.invalid("rejects type query", 'type Crypto = typeof import("node:crypto");');
  outside.invalid(
    "rejects native alternative",
    'const crypto = process.getBuiltinModule("crypto");',
  );
  outside.invalid(
    "rejects computed native alternative",
    'const crypto = process["getBuiltinModule"]("crypto");',
  );
  named.invalid(
    "rejects expansion of an existing broad exemption",
    `${broad}\nimport { createHash, randomUUID, randomBytes } from "node:crypto";`,
  );
  outside.invalid(
    "rejects require alias",
    'const load = require; const crypto = load("node:crypto");',
  );
  outside.invalid(
    "rejects aliased createRequire loader",
    'import { createRequire as make } from "node:module"; const load = make(import.meta.url); const crypto = load("crypto");',
  );
  outside.invalid(
    "rejects createRequire loader escape",
    'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); const other = load;',
  );
  outside.invalid(
    "rejects createRequire namespace",
    'import * as Module from "node:module"; const load = Module.createRequire(import.meta.url);',
  );
  outside.invalid(
    "rejects multiline broad comment",
    `/* ${broad.slice(3).replace(" nodeBuiltinImport", "\n nodeBuiltinImport")} */`,
  );
  rule.invalid(
    "rejects native import before crypto on same line",
    valid.replace("import * as Crypto", 'import * as Fs from "node:fs"; import * as Crypto'),
  );
  outside.invalid(
    "rejects composed native loader property",
    'process["get" + "BuiltinModule"]("crypto");',
  );
  outside.invalid(
    "rejects destructured native loader",
    'const { getBuiltinModule: load } = process; load("crypto");',
  );
  outside.invalid("rejects module.require", 'module.require("node:crypto");');
  outside.invalid(
    "rejects dynamically loading a module loader",
    'const Module = await import("node:module");',
  );
  outside.invalid("rejects reexported loader", 'export { createRequire } from "node:module";');
});

describe("security-review regressions: native inventory and loader provenance", () => {
  const legacy = createOxlintRuleHarness(
    "t3code/native-crypto-boundary",
    "packages/shared/src/logging.ts",
  );
  const legacyImports = `${broad}\nimport fs from "node:fs";\nimport path from "node:path";`;
  const inventoryFailure = (output: string) =>
    assert.include(output, "native imports under a legacy broad exception changed");
  legacy.valid("preserves exact frozen legacy imports", legacyImports);
  legacy.invalid(
    "requires review for bare spelling changes to frozen imports",
    legacyImports.replaceAll("node:", ""),
    inventoryFailure,
  );
  legacy.valid(
    "does not classify packages and relative lookalikes as Node built-ins",
    `${legacyImports}\nimport localFs from "./fs"; import fsExtra from "fs-extra"; import other from "@example/module";`,
  );
  for (const name of [
    "fs",
    "node:fs",
    "fs/promises",
    "node:fs/promises",
    "module",
    "node:module",
    "process",
    "node:process",
  ]) {
    legacy.invalid(
      `rejects adding native import ${name} under a legacy exception`,
      `${legacyImports}\nimport * as Added from "${name}";`,
      inventoryFailure,
    );
  }
  legacy.invalid(
    "rejects the reviewed bare readFileSync inventory expansion",
    `${legacyImports}\nimport { readFileSync } from "fs";`,
    inventoryFailure,
  );
  legacy.invalid(
    "rejects replacing inventoried default binding with bare named imports",
    legacyImports.replace('import fs from "node:fs";', 'import { readFileSync } from "fs";'),
    inventoryFailure,
  );
  legacy.invalid(
    "rejects removing inventoried imports",
    legacyImports.replace('import fs from "node:fs";', ""),
    inventoryFailure,
  );
  for (const name of ["module", "node:module"]) {
    for (const form of [
      "{ Module }",
      "{ Module as NativeModule }",
      "* as Module",
      "Module",
      "{ default as Module }",
    ]) {
      const binding = form.includes("NativeModule") ? "NativeModule" : "Module";
      outside.invalid(
        `rejects ${form} createRequire from ${name}`,
        `import ${form} from "${name}"; const crypto = ${binding}.createRequire(import.meta.url)("crypto");`,
      );
    }
    outside.valid(
      `allows named createRequire for a nonescaping noncrypto loader from ${name}`,
      `import { createRequire as make } from "${name}"; const load = make(import.meta.url); load("fs"); load.resolve("some-package");`,
    );
    outside.valid(
      `allows unrelated named module utilities from ${name}`,
      `import { isBuiltin } from "${name}"; isBuiltin("fs");`,
    );
  }
  for (const expression of [
    'globalThis.process.getBuiltinModule("crypto")',
    'globalThis["process"].getBuiltinModule("node:crypto")',
    'globalThis.process["getBuiltinModule"]("crypto")',
    '(globalThis.process as typeof process).getBuiltinModule("crypto")',
  ] as const) {
    outside.invalid(`rejects qualified process loader ${expression}`, `${expression};`);
  }
  for (const init of ["process", "globalThis.process", "(process as typeof process)"]) {
    outside.invalid(
      `rejects a const alias of ${init}`,
      `const nativeProcess = ${init}; nativeProcess.getBuiltinModule("crypto");`,
    );
    outside.valid(
      `allows benign reads through a const alias of ${init}`,
      `const nativeProcess = ${init}; nativeProcess.env.NODE_ENV; nativeProcess.cwd();`,
    );
  }
  outside.invalid(
    "follows chained const aliases into nested lexical scopes",
    'const first = process; function use() { const second = first; second.getBuiltinModule("crypto"); }',
  );
  outside.invalid(
    "rejects extracting a loader from a process alias",
    'const nativeProcess = process; const { getBuiltinModule: load } = nativeProcess; load("crypto");',
  );
  outside.invalid(
    "rejects detached process loader from a qualified global",
    'const load = globalThis.process.getBuiltinModule; load("crypto");',
  );
  for (const name of ["process", "node:process"]) {
    for (const form of ["{ getBuiltinModule }", "{ getBuiltinModule as load }"]) {
      const binding = form.includes("load") ? "load" : "getBuiltinModule";
      outside.invalid(
        `rejects imported ${form} from ${name}`,
        `import ${form} from "${name}"; ${binding}("crypto");`,
      );
    }
    for (const form of ["nativeProcess", "* as nativeProcess", "{ default as nativeProcess }"]) {
      outside.invalid(
        `rejects process loader through ${form} from ${name}`,
        `import ${form} from "${name}"; const alias = nativeProcess; alias.getBuiltinModule("crypto");`,
      );
      outside.valid(
        `allows benign process use through ${form} from ${name}`,
        `import ${form} from "${name}"; const alias = nativeProcess; alias.env.NODE_ENV;`,
      );
    }
    outside.invalid(
      `rejects process namespace default loader from ${name}`,
      `import * as nativeProcess from "${name}"; nativeProcess.default.getBuiltinModule("crypto");`,
    );
    outside.valid(
      `allows unrelated named process utilities from ${name}`,
      `import { cwd } from "${name}"; cwd();`,
    );
  }
  for (const source of [
    'function use(process) { const alias = process; alias.getBuiltinModule("crypto"); process["getBuiltinModule"]("crypto"); const { getBuiltinModule } = process; }',
    'function use(globalThis) { globalThis.process.getBuiltinModule("crypto"); const alias = globalThis.process; alias.getBuiltinModule("crypto"); }',
    'function use(module) { module.require("crypto"); const { require: load } = module; }',
    'function use(require) { require("crypto"); const load = require; load("crypto"); }',
    'const Module = { createRequire: () => () => 1 }; Module.createRequire()("crypto");',
    'import { Module, getBuiltinModule, process, globalThis } from "unrelated-package"; Module.createRequire()("crypto"); getBuiltinModule("crypto"); process.getBuiltinModule("crypto"); globalThis.process.getBuiltinModule("crypto");',
    'import nativeProcess from "node:process"; function use(nativeProcess) { const alias = nativeProcess; alias.getBuiltinModule("crypto"); }',
    'const alias = process; function use(alias) { alias.getBuiltinModule("crypto"); }',
    'const process = { getBuiltinModule: () => 1 }; process.getBuiltinModule("crypto");',
  ] as const) {
    outside.valid(`does not confuse shadowed unrelated identifiers: ${source}`, source);
  }
  outside.invalid(
    "does not let an inner process shadow hide an outer native alias",
    'const alias = process; function use(process) { alias.getBuiltinModule("crypto"); }',
  );
});
