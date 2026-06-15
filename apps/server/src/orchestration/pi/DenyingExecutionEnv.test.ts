import { assert, describe, it } from "@effect/vitest";

import { DenyingExecutionEnv } from "./DenyingExecutionEnv.ts";

describe("DenyingExecutionEnv", () => {
  it("allows inert path helpers", async () => {
    const env = new DenyingExecutionEnv("/repo");

    const absolute = await env.absolutePath("src/index.ts");
    const joined = await env.joinPath(["src", "..", "package.json"]);

    assert.deepStrictEqual(absolute, { ok: true, value: "/repo/src/index.ts" });
    assert.deepStrictEqual(joined, { ok: true, value: "/repo/package.json" });
  });

  it("denies filesystem and shell capabilities", async () => {
    const env = new DenyingExecutionEnv("/repo");

    const read = await env.readTextFile("README.md");
    const write = await env.writeFile("README.md", "updated");
    const exec = await env.exec("git status");

    assert.strictEqual(read.ok, false);
    assert.strictEqual(write.ok, false);
    assert.strictEqual(exec.ok, false);
    if (!read.ok) assert.strictEqual(read.error.code, "permission_denied");
    if (!write.ok) assert.strictEqual(write.error.code, "permission_denied");
    if (!exec.ok) assert.strictEqual(exec.error.code, "shell_unavailable");
  });
});
