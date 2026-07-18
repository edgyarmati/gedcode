// @effect-diagnostics nodeBuiltinImport:off
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readRepoFile = (path: string) => readFile(resolve(repoRoot, path), "utf8");

const mirroredSkillFiles = [
  "grill-with-docs/SKILL.md",
  "grill-with-docs/agents/openai.yaml",
  "grilling/SKILL.md",
  "grilling/agents/openai.yaml",
  "domain-modeling/SKILL.md",
  "domain-modeling/CONTEXT-FORMAT.md",
  "domain-modeling/ADR-FORMAT.md",
  "domain-modeling/agents/openai.yaml",
] as const;

describe("vendored GED clarification skills", () => {
  it("ships identical Codex and Claude resources", async () => {
    for (const path of mirroredSkillFiles) {
      const [codex, claude] = await Promise.all([
        readRepoFile(`.agents/skills/${path}`),
        readRepoFile(`.claude/skills/${path}`),
      ]);
      expect(codex, path).toBe(claude);
    }
  });

  it("keeps the docs-aware interview and GED planning handoff explicit", async () => {
    const [wrapper, grilling, domain, contextFormat, adrFormat, skills, notice] = await Promise.all(
      [
        readRepoFile(".agents/skills/grill-with-docs/SKILL.md"),
        readRepoFile(".agents/skills/grilling/SKILL.md"),
        readRepoFile(".agents/skills/domain-modeling/SKILL.md"),
        readRepoFile(".agents/skills/domain-modeling/CONTEXT-FORMAT.md"),
        readRepoFile(".agents/skills/domain-modeling/ADR-FORMAT.md"),
        readRepoFile(".ged/SKILLS.md"),
        readRepoFile("THIRD_PARTY_NOTICES.md"),
      ],
    );

    expect(wrapper).toContain("Run a `/grilling` session, using the `/domain-modeling` skill");
    expect(wrapper).toContain("phase in `.ged/work/root/STATE.md` to `clarify`");
    expect(wrapper).toContain("phase to `plan`");
    expect(wrapper).toContain("continue with `/ged-planning`");
    expect(wrapper).toContain("root `CONTEXT.md`");
    expect(wrapper).toContain("`docs/adr/`");
    expect(wrapper).toContain("Do not create `.ged/DECISIONS.md`");

    expect(grilling).toContain("For each question, provide your recommended answer");
    expect(grilling).toContain("Ask the questions one at a time");
    expect(grilling).toContain("exploring the environment");
    expect(grilling).toContain("Do not act on it until I confirm");

    expect(domain).toContain("update `CONTEXT.md` right there");
    expect(domain).toContain("totally devoid of implementation details");
    expect(domain).toContain("canonical context files are root `CONTEXT.md` and root `docs/adr/`");
    expect(domain).toContain("Do not create or follow `CONTEXT-MAP.md`");
    expect(domain).toContain("Hard to reverse");
    expect(domain).toContain("Surprising without context");
    expect(domain).toContain("The result of a real trade-off");
    expect(contextFormat).toContain("Define what it IS, not what it does");
    expect(contextFormat).toContain("Use one `CONTEXT.md` at the repository root");
    expect(adrFormat).toContain(
      "Scan `docs/adr/` for the highest existing number and increment by one",
    );

    expect(skills).toContain("grill-with-docs [vendored]");
    expect(skills).not.toContain("grill-me [auto-install]");
    expect(notice).toContain("9603c1cc8118d08bc1b3bf34cf714f62178dea3b");
    expect(notice).toContain("Copyright (c) 2026 Matt Pocock");
  });
});
