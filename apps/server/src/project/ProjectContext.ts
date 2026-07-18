import { createHash } from "node:crypto";
import {
  ProjectContextFingerprint,
  ProjectContextSchemaVersion,
  type ProjectContextResolution,
} from "@t3tools/contracts";

export const PROJECT_CONTEXT_SCHEMA_VERSION = ProjectContextSchemaVersion.make(1);
export const MAX_PROJECT_CONTEXT_FILE_BYTES = 256 * 1024;

export const CANONICAL_PROJECT_CONTEXT_PATHS = [
  "AGENTS.md",
  ".ged/PROJECT.md",
  ".ged/ARCHITECTURE.md",
  "CONTEXT.md",
] as const;

export type CanonicalProjectContextPath = (typeof CANONICAL_PROJECT_CONTEXT_PATHS)[number];

export type ProjectContextClassification =
  | "missing"
  | "empty"
  | "whitespace"
  | "template"
  | "substantive";

export interface ProjectContextFile {
  readonly relativePath: string;
  readonly classification: ProjectContextClassification;
  readonly normalizedContent: string;
}

export interface ProjectContextSnapshot {
  readonly schemaVersion: ProjectContextSchemaVersion;
  readonly files: ReadonlyArray<ProjectContextFile>;
  readonly fingerprint: ProjectContextFingerprint;
  readonly promptKind: "populate" | "review";
}

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const MARKDOWN_HEADING_PATTERN = /^ {0,3}#{1,6}(?:[ \t]+.*)?$/;

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function trimOuterBlankLines(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim().length === 0) start += 1;
  while (end > start && lines[end - 1]?.trim().length === 0) end -= 1;
  return lines.slice(start, end);
}

/** Removes intentionally non-semantic Markdown comments and formatting noise. */
export function normalizeProjectContextContent(content: string): string {
  const withoutComments = content.replace(HTML_COMMENT_PATTERN, "");
  const lines = withoutComments
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  return trimOuterBlankLines(lines).join("\n");
}

export function classifyProjectContextContent(content: string): ProjectContextClassification {
  if (content.length === 0) return "empty";
  if (content.trim().length === 0) return "whitespace";

  const withoutComments = content.replace(HTML_COMMENT_PATTERN, "").replace(/\r\n?/g, "\n");
  const meaningfulLines = withoutComments.split("\n").filter((line) => line.trim().length > 0);
  if (meaningfulLines.length === 0) return "template";
  if (meaningfulLines.every((line) => MARKDOWN_HEADING_PATTERN.test(line))) {
    return "template";
  }
  return "substantive";
}

export function fingerprintProjectContext(input: {
  readonly schemaVersion: ProjectContextSchemaVersion;
  readonly files: ReadonlyArray<
    Pick<ProjectContextFile, "relativePath" | "classification" | "normalizedContent">
  >;
}): ProjectContextFingerprint {
  const manifest = {
    schemaVersion: input.schemaVersion,
    files: [...input.files]
      .toSorted((left, right) => compareCodeUnits(left.relativePath, right.relativePath))
      .map((file) => ({
        relativePath: file.relativePath,
        classification: file.classification,
        normalizedContent: file.normalizedContent,
      })),
  };
  return ProjectContextFingerprint.make(
    `sha256:${createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex")}`,
  );
}

export function makeProjectContextSnapshot(input: {
  readonly schemaVersion?: ProjectContextSchemaVersion;
  readonly files: ReadonlyArray<ProjectContextFile>;
}): ProjectContextSnapshot {
  const schemaVersion = input.schemaVersion ?? PROJECT_CONTEXT_SCHEMA_VERSION;
  const files = [...input.files];
  return {
    schemaVersion,
    files,
    fingerprint: fingerprintProjectContext({ schemaVersion, files }),
    promptKind: files.some((file) => file.classification === "substantive") ? "review" : "populate",
  };
}

export function shouldPromptForProjectContext(
  snapshot: Pick<ProjectContextSnapshot, "schemaVersion" | "fingerprint">,
  resolution: ProjectContextResolution | null,
): boolean {
  return (
    resolution === null ||
    resolution.schemaVersion !== snapshot.schemaVersion ||
    resolution.fingerprint !== snapshot.fingerprint
  );
}
