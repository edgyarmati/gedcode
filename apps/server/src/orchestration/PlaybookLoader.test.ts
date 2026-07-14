import { assert, describe, it } from "@effect/vitest";

import { PlaybookLoader } from "./PlaybookLoader.ts";

describe("PlaybookLoader", () => {
  it("resolves the built-in feature playbook into a pi-compatible Skill", () => {
    const loader = new PlaybookLoader();

    const resolved = loader.resolve("feature");

    assert.ok(resolved);
    assert.strictEqual(resolved.frontmatter.name, "feature-orchestration");
    assert.strictEqual(
      resolved.frontmatter.description,
      'How to orchestrate a "feature" task — recommended stages, when to review, and definition of done.',
    );
    assert.strictEqual(resolved.skill.name, resolved.frontmatter.name);
    assert.strictEqual(resolved.skill.description, resolved.frontmatter.description);
    assert.strictEqual(resolved.skill.content, resolved.body);
    assert.strictEqual(
      resolved.skill.filePath,
      "/__builtin__/orchestration/playbooks/feature/SKILL.md",
    );
    assert.match(resolved.skill.content, /^# Orchestrating a feature task/);
    assert.match(resolved.playbookVersion, /^builtin:[0-9a-f]{12}$/);
  });

  it("computes a stable built-in playbook version across calls", () => {
    const loader = new PlaybookLoader();

    const first = loader.resolve("feature");
    const second = loader.resolve("feature");

    assert.ok(first);
    assert.ok(second);
    assert.strictEqual(first.playbookVersion, second.playbookVersion);
  });

  it("resolves the registered release playbook", () => {
    const release = new PlaybookLoader().resolve("release");

    assert.ok(release);
    assert.strictEqual(release.frontmatter.name, "release-orchestration");
    assert.match(release.body, /fully landed feature task/);
    assert.match(release.playbookVersion, /^builtin:[0-9a-f]{12}$/);
  });

  it("returns none for unknown task types without throwing", () => {
    const loader = new PlaybookLoader();

    assert.doesNotThrow(() => {
      assert.strictEqual(loader.resolve("unknown"), undefined);
    });
  });

  it("returns none when a source cannot resolve a playbook", () => {
    const loader = new PlaybookLoader([
      {
        id: "broken",
        resolve: () => {
          throw new Error("source unavailable");
        },
      },
    ]);

    assert.doesNotThrow(() => {
      assert.strictEqual(loader.resolve("feature"), undefined);
    });
  });
});
