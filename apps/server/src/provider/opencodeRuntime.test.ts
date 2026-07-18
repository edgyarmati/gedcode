import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { buildOpenCodePermissionRules } from "./opencodeRuntime.ts";

describe("OpenCode read-only permissions", () => {
  it("allows inspection while denying every mutation and delegation surface", () => {
    const rules = buildOpenCodePermissionRules("full-access", { readOnly: true });
    const actionFor = (permission: string) =>
      rules.findLast((rule) => rule.permission === "*" || rule.permission === permission)?.action;

    assert.equal(actionFor("read"), "allow");
    assert.equal(actionFor("glob"), "allow");
    assert.equal(actionFor("grep"), "allow");
    assert.equal(actionFor("lsp"), "allow");
    assert.equal(actionFor("edit"), "deny");
    assert.equal(actionFor("bash"), "deny");
    assert.equal(actionFor("external_directory"), "deny");
    assert.equal(actionFor("task"), "deny");
    assert.equal(actionFor("question"), "deny");
  });
});
