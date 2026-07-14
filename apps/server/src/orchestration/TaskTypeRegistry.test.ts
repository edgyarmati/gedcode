import { TaskTypeId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { TaskTypeRegistry, defaultTaskTypeRegistry } from "./TaskTypeRegistry.ts";

describe("TaskTypeRegistry", () => {
  it("registers feature with its built-in playbook", () => {
    const feature = defaultTaskTypeRegistry.get("feature");

    assert.ok(feature);
    assert.strictEqual(feature.id, TaskTypeId.make("feature"));
    assert.match(feature.playbook.text, /^---/);
    assert.strictEqual(
      feature.playbook.filePath,
      "/__builtin__/orchestration/playbooks/feature/SKILL.md",
    );
    assert.deepStrictEqual(defaultTaskTypeRegistry.ids(), [TaskTypeId.make("feature")]);
  });

  it("rejects duplicate registrations", () => {
    const feature = defaultTaskTypeRegistry.get("feature");
    assert.ok(feature);

    assert.throws(
      () => new TaskTypeRegistry([feature, feature]),
      /Duplicate orchestration task type/,
    );
  });
});
