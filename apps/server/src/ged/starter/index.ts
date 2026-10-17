import { LAND_GATE } from "./landGate.ts";

/**
 * The `.ged/` a project starts with. Each file is a short skeleton the lead
 * fills in as work happens; the process itself lives in the served playbooks,
 * so nothing here goes stale when GedCode updates.
 */

const PROJECT = `# Project

What this project is, who it is for, and what it builds on. Keep to what an agent needs before
touching the code.
`;

const STANDARDS = `# Standards

How work is done here. Agents read this before changing anything.

## Checks

The commands that prove a change works. Implementers and verifiers run these, narrowed to what a
change touched where the tool allows it.

| Check     | Command |
| --------- | ------- |
| Format    |         |
| Lint      |         |
| Typecheck |         |
| Test      |         |

## Conventions
`;

const DECISIONS = `# Decisions

Durable decisions and why, newest last. Each entry: the date, the decision, the reason, and what it
rules out.
`;

const CONTEXT_MAP = `# Context Map

The words this project uses and where things live. Grilling adds the terms the user and the agent
agreed on.

## Terms

| Term | Means |
| ---- | ----- |

## Where things live
`;

const PROGRESS = `# Progress

What landed, newest last: the date, what changed, and how it was verified.
`;

const MODEL_NOTES = `# Model notes

Models the user asked for, by kind of task. The lead tries these first; when one is unavailable it
uses what it can and says so in the thread. Empty means the lead chooses within its own family.
`;

const PLAN_INDEX = `# Plan Index

| ID  | Title | Status | Created | Completed |
| --- | ----- | ------ | ------- | --------- |
`;

export interface StarterFile {
  /** Relative to the project root. */
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
}

export const STARTER_FILES: ReadonlyArray<StarterFile> = [
  { path: ".ged/PROJECT.md", content: PROJECT },
  { path: ".ged/STANDARDS.md", content: STANDARDS },
  { path: ".ged/DECISIONS.md", content: DECISIONS },
  { path: ".ged/CONTEXT-MAP.md", content: CONTEXT_MAP },
  { path: ".ged/PROGRESS.md", content: PROGRESS },
  { path: ".ged/model-notes.md", content: MODEL_NOTES },
  { path: ".ged/plans/INDEX.md", content: PLAN_INDEX },
  { path: ".ged/verdicts/.gitignore", content: "*.json\n" },
  { path: ".ged/bin/land-gate.sh", content: LAND_GATE, mode: 0o755 },
];
