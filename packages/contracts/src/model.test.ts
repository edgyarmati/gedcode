import { assert, it } from "@effect/vitest";

import { DEFAULT_MODEL, DEFAULT_MODEL_BY_PROVIDER } from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

it("uses Sol as the Codex factory model without changing Claude's native default", () => {
  assert.strictEqual(DEFAULT_MODEL, "gpt-5.6-sol");
  assert.strictEqual(DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("codex")], "gpt-5.6-sol");
  assert.strictEqual(
    DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("claudeAgent")],
    "claude-sonnet-4-6",
  );
});
