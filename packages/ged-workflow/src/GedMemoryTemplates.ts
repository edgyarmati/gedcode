export const GED_DIRECTORY = ".ged";
export const GED_VERSION = "3";

export const TIER1_FILES: ReadonlyArray<{ readonly path: string; readonly content: string }> = [
  { path: "VERSION", content: GED_VERSION },
  { path: "PROJECT.md", content: "# Project\n\n> Goal, users, constraints, success criteria.\n" },
  {
    path: "ARCHITECTURE.md",
    content: "# Architecture\n\n> Component boundaries and system shape.\n",
  },
  {
    path: "PATTERNS.md",
    content: "# Patterns\n\n> Implementation conventions used in this project.\n",
  },
  { path: "GLOSSARY.md", content: "# Glossary\n\n> Project and domain vocabulary.\n" },
  {
    path: "DECISIONS.md",
    content: "# Decisions\n\n> Durable decisions and rationale (ADR-style).\n",
  },
  { path: "STANDARDS.md", content: "# Standards\n\n> Imported repo-wide agent standards.\n" },
  {
    path: "CONTEXT-MAP.md",
    content:
      "# Context Map\n\nThis directory uses the Ged memory model:\n\n- **Tier 1 (root)**: Durable project context, committed.\n- **Tier 2 (work/)**: Per-branch active planning artifacts.\n- **Tier 3 (runtime/)**: Ephemeral session state, gitignored.\n",
  },
];

export const TIER2_FILES: ReadonlyArray<{ readonly path: string; readonly content: string }> = [
  {
    path: "SPEC.md",
    content: "# Spec\n\n> Current work-item contract. Fill before implementation.\n",
  },
  { path: "TASKS.md", content: "# Tasks\n\n> Bounded implementation slices.\n" },
  { path: "TESTS.md", content: "# Tests\n\n> Verification plan and evidence.\n" },
  { path: "NOTES.md", content: "# Notes\n\n> Handoff notes for cross-session context.\n" },
];

export const TIER3_FILES: ReadonlyArray<{ readonly path: string; readonly content: string }> = [
  {
    path: "STATE.md",
    content:
      "# State\n\n- **Phase**: classify\n- **Active task**: none\n- **Blockers**: none\n- **Next step**: Classify the incoming request\n",
  },
  {
    path: "SESSION-SUMMARY.md",
    content: "# Session Summary\n\n> Updated at end of each session for cross-session handoff.\n",
  },
];

export const GED_GITIGNORE = "runtime/\n";

export const INITIAL_CHECKPOINT_STATE = {
  schemaVersion: 3,
  lifecycleStatus: "active",
  classification: "trivial",
  classificationReason: "Awaiting first task classification",
  planCheckpoints: {},
  taskCheckpoints: {},
} as const;

/**
 * Pre-serialized JSON of INITIAL_CHECKPOINT_STATE.
 * Avoids runtime JSON.stringify which triggers the Effect Language Service
 * `preferSchemaOverJson` diagnostic.
 */
export const INITIAL_CHECKPOINT_STATE_JSON = `{
  "schemaVersion": 3,
  "lifecycleStatus": "active",
  "classification": "trivial",
  "classificationReason": "Awaiting first task classification",
  "planCheckpoints": {},
  "taskCheckpoints": {}
}`;
