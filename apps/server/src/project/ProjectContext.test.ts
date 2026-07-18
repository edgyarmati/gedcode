import { describe, expect, it } from "@effect/vitest";
import {
  ProjectContextFingerprint,
  ProjectContextSchemaVersion,
  type ProjectContextResolution,
} from "@t3tools/contracts";

import {
  classifyProjectContextContent,
  fingerprintProjectContext,
  makeProjectContextSnapshot,
  normalizeProjectContextContent,
  shouldPromptForProjectContext,
} from "./ProjectContext.ts";

describe("ProjectContext", () => {
  it("keeps empty, whitespace, template, and substantive Markdown distinct", () => {
    expect(classifyProjectContextContent("")).toBe("empty");
    expect(classifyProjectContextContent(" \t\r\n")).toBe("whitespace");
    expect(classifyProjectContextContent("# Project\n<!-- generated stub -->\n## Scope\n")).toBe(
      "template",
    );
    expect(classifyProjectContextContent("<!-- generated stub -->\n")).toBe("template");
    expect(classifyProjectContextContent("# Project\n- Own the release process\n")).toBe(
      "substantive",
    );
    expect(classifyProjectContextContent("<!-- unclosed")).toBe("substantive");
  });

  it("keeps fingerprints stable for semantic formatting noise and changes them for material input", () => {
    const noisy = "\r\n# Context  \r\n<!-- generated -->\r\n\r\n";
    expect(normalizeProjectContextContent(noisy)).toBe("# Context");

    const base = fingerprintProjectContext({
      schemaVersion: ProjectContextSchemaVersion.make(1),
      files: [
        { relativePath: "CONTEXT.md", classification: "template", normalizedContent: "# Context" },
      ],
    });
    expect(base).toBe(
      fingerprintProjectContext({
        schemaVersion: ProjectContextSchemaVersion.make(1),
        files: [
          {
            relativePath: "CONTEXT.md",
            classification: "template",
            normalizedContent: normalizeProjectContextContent(noisy),
          },
        ],
      }),
    );
    expect(base).not.toBe(
      fingerprintProjectContext({
        schemaVersion: ProjectContextSchemaVersion.make(2),
        files: [
          {
            relativePath: "CONTEXT.md",
            classification: "template",
            normalizedContent: "# Context",
          },
        ],
      }),
    );
    expect(base).not.toBe(
      fingerprintProjectContext({
        schemaVersion: ProjectContextSchemaVersion.make(1),
        files: [
          {
            relativePath: "CONTEXT.md",
            classification: "template",
            normalizedContent: "# Changed context",
          },
        ],
      }),
    );
    expect(base).toBe(
      fingerprintProjectContext({
        schemaVersion: ProjectContextSchemaVersion.make(1),
        files: [
          {
            relativePath: "CONTEXT.md",
            classification: "template",
            normalizedContent: "# Context",
          },
        ],
      }),
    );
  });

  it("uses review if and only if any scanned context is substantive", () => {
    expect(
      makeProjectContextSnapshot({
        files: [
          { relativePath: "AGENTS.md", classification: "missing", normalizedContent: "" },
          {
            relativePath: "docs/adr/0001.md",
            classification: "substantive",
            normalizedContent: "# ADR",
          },
        ],
      }).promptKind,
    ).toBe("review");
    expect(
      makeProjectContextSnapshot({
        files: [
          { relativePath: "AGENTS.md", classification: "missing", normalizedContent: "" },
          { relativePath: "CONTEXT.md", classification: "empty", normalizedContent: "" },
          {
            relativePath: "docs/adr/0001.md",
            classification: "template",
            normalizedContent: "# ADR",
          },
        ],
      }).promptKind,
    ).toBe("populate");
  });

  it("prompts until the exact scanner schema and fingerprint have been resolved", () => {
    const snapshot = makeProjectContextSnapshot({
      files: [
        { relativePath: "AGENTS.md", classification: "template", normalizedContent: "# Agent" },
      ],
    });
    const resolved = (outcome: ProjectContextResolution["outcome"]): ProjectContextResolution => ({
      schemaVersion: snapshot.schemaVersion,
      fingerprint: snapshot.fingerprint,
      outcome,
      resolvedAt: "2026-07-18T00:00:00.000Z",
    });

    expect(shouldPromptForProjectContext(snapshot, null)).toBe(true);
    expect(shouldPromptForProjectContext(snapshot, resolved("dismissed"))).toBe(false);
    expect(shouldPromptForProjectContext(snapshot, resolved("completed"))).toBe(false);
    expect(
      shouldPromptForProjectContext(snapshot, {
        ...resolved("completed"),
        schemaVersion: ProjectContextSchemaVersion.make(2),
      }),
    ).toBe(true);
    expect(
      shouldPromptForProjectContext(snapshot, {
        ...resolved("completed"),
        fingerprint: ProjectContextFingerprint.make(`sha256:${"0".repeat(64)}`),
      }),
    ).toBe(true);
  });
});
