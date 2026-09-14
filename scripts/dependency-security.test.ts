// @effect-diagnostics nodeBuiltinImport:off

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Exercise the installed transitive parser, not a separately installed test copy.
// Effect beta.73 declares TOML even though its current source has no parser call site.
const requireFromEffect = createRequire(import.meta.resolve("effect/package.json"));
const toml = requireFromEffect("toml") as { parse: (source: string) => unknown };

describe("transitive TOML security and compatibility", () => {
  it("preserves nested configuration parsing and syntax errors", () => {
    expect(toml.parse('[server]\nport = 3773\nenabled = true\ntags = ["a", "b"]')).toEqual({
      server: { port: 3773, enabled: true, tags: ["a", "b"] },
    });
    expect(() => toml.parse("key = [")).toThrow();
  });

  it("rejects excessive nesting with a parse error rather than exhausting the stack", () => {
    expect(() => toml.parse(`key = ${"[".repeat(501)}0${"]".repeat(501)}`)).toThrow(
      /nesting|depth/i,
    );
  });

  it("rejects scalar prototype traversal despite nested-table path tracking", () => {
    // GHSA-v5mp-jgw5-2x6j: isolate the exploit so a dependency regression cannot
    // pollute the Vitest process before the assertion reports it.
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        `const toml = require(process.argv[1]);
       let rejected = false;
       try { toml.parse("[a.b]\\ny = 1\\n[a.b.y.__proto__.__proto__]\\nreleasePolluted = true"); }
       catch { rejected = true; }
       if (!rejected || Object.hasOwn(Object.prototype, "releasePolluted")) process.exit(1);`,
        requireFromEffect.resolve("toml"),
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(probe.error).toBeUndefined();
    expect(probe.signal).toBeNull();
    expect(probe.stderr).toBe("");
    expect(probe.status).toBe(0);
  });

  it("does not let __proto__ key paths write to Object.prototype", () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    // Legal TOML keys must remain own data properties, including reserved JS names.
    const parsed = toml.parse(
      "[__proto__]\nreleasePolluted = true\n[constructor.prototype]\nx = 1",
    );
    expect(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value).toEqual({
      releasePolluted: true,
    });
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
    expect(Object.hasOwn(parsed as object, "__proto__")).toBe(true);
  });
});
