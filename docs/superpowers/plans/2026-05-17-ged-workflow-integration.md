# Ged Workflow Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ged workflow (classify → clarify → plan → implement → verify → commit) work across all GedCode providers (Codex, Claude, Cursor, OpenCode) — zero-config, provider-agnostic.

**Architecture:** A new `packages/ged-workflow` package owns the checkpoint schema, validation logic, .ged/ bootstrap templates, and skill definitions. A `GedWorkflowService` Effect service in `apps/server` wires into the provider layer — intercepting `sendTurn` to inject workflow context and consuming `streamEvents` to react to file-change / commit / subagent-completion events. The web UI surfaces workflow state (phase, checkpoints, classification) via existing orchestration event projections.

**Tech Stack:** TypeScript, Effect 4.0.0-beta.59, Effect/Schema, Vitest, Bun

---

## File Structure

### New package: `packages/ged-workflow/`

| File                          | Responsibility                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                | Package manifest, Effect dependency                                                                                                                      |
| `tsconfig.json`               | Extends base config                                                                                                                                      |
| `src/index.ts`                | Public API barrel export                                                                                                                                 |
| `src/CheckpointSchema.ts`     | Schema v3 types: CheckpointState, CheckpointRecord, ClarificationRecord                                                                                  |
| `src/CheckpointValidation.ts` | Pure validation functions: validatePlannerCheckpoint, validateCommitCheckpoints, shouldAutoEscalate, invalidateVerifierCheckpoints, closeCheckpointState |
| `src/GedMemoryTemplates.ts`   | .ged/ directory structure and starter file content templates                                                                                             |
| `src/GedBootstrap.ts`         | Bootstrap logic: create .ged/ tree, detect repo signals, write starter files                                                                             |
| `src/WorkflowPrompt.ts`       | System prompt suffix builder: workflow rules, checkpoint requirements, single-writer invariant                                                           |
| `src/SkillRegistry.ts`        | Bundled skill definitions: grill-me, ged-planning, ged-execution, ged-verification                                                                       |

### New server module: `apps/server/src/gedWorkflow/`

| File                                   | Responsibility                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Services/GedWorkflowService.ts`       | Effect service tag + shape: bootstrap, readState, validateTurn, recordCheckpoint                                                                           |
| `Layers/GedWorkflowServiceLive.ts`     | Live implementation: FileSystem-backed .ged/ state management                                                                                              |
| `Layers/GedWorkflowTurnInterceptor.ts` | Wraps ProviderService.sendTurn to inject workflow prompt suffix into turn input                                                                            |
| `Layers/GedWorkflowEventReactor.ts`    | Consumes ProviderRuntimeEvent stream: detects file changes (invalidate verifier), git commits (enforce verifier), subagent completions (record checkpoint) |

### New contract types: `packages/contracts/src/`

| File             | Responsibility                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `gedWorkflow.ts` | Shared schemas: GedWorkflowState (for WebSocket RPC), GedWorkflowPhase, GedTaskClassification |

### Modified files

| File                                 | Change                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `packages/ged-workflow/package.json` | New package manifest                                                   |
| `package.json` (root)                | Add `packages/ged-workflow` to workspaces                              |
| `apps/server/package.json`           | Add `@t3tools/ged-workflow` dependency                                 |
| `apps/server/src/server.ts`          | Wire GedWorkflowServiceLive + GedWorkflowEventReactor into layer stack |
| `apps/server/src/ws.ts`              | Add RPC endpoint for workflow state subscription                       |
| `packages/contracts/src/index.ts`    | Re-export gedWorkflow types                                            |
| `apps/web/src/store.ts`              | Add workflow state to EnvironmentState                                 |

---

## Task 1: Create `packages/ged-workflow` package scaffold

**Files:**

- Create: `packages/ged-workflow/package.json`
- Create: `packages/ged-workflow/tsconfig.json`
- Create: `packages/ged-workflow/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@t3tools/ged-workflow",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    },
    "./*": {
      "types": "./src/*.ts",
      "import": "./src/*.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "effect": "catalog:"
  },
  "devDependencies": {
    "@effect/language-service": "catalog:",
    "@effect/vitest": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create empty barrel export**

```typescript
// packages/ged-workflow/src/index.ts
export * from "./CheckpointSchema.ts";
export * from "./CheckpointValidation.ts";
export * from "./GedBootstrap.ts";
export * from "./GedMemoryTemplates.ts";
export * from "./WorkflowPrompt.ts";
export * from "./SkillRegistry.ts";
```

- [ ] **Step 4: Add to root workspaces**

In root `package.json`, the `workspaces` field already uses `"packages/*"` glob, so `packages/ged-workflow` is auto-discovered. Verify:

Run: `cd /Users/edgy/projects/gedcode && bun install`
Expected: No errors, `@t3tools/ged-workflow` resolves.

- [ ] **Step 5: Commit**

```bash
git add packages/ged-workflow/
git commit -m "feat: scaffold @t3tools/ged-workflow package"
```

---

## Task 2: Implement CheckpointSchema (types)

**Files:**

- Create: `packages/ged-workflow/src/CheckpointSchema.ts`
- Test: `packages/ged-workflow/src/CheckpointSchema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ged-workflow/src/CheckpointSchema.test.ts
import { describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { CheckpointState } from "./CheckpointSchema.ts";

describe("CheckpointState", () => {
  it.effect("decodes a valid active checkpoint state", () =>
    Schema.decodeUnknown(CheckpointState)({
      schemaVersion: 3,
      lifecycleStatus: "active",
      classification: "non-trivial",
      classificationReason: "Multi-file feature implementation",
      planCheckpoints: {},
      taskCheckpoints: {},
    }),
  );

  it.effect("decodes a state with recorded planner checkpoint", () =>
    Schema.decodeUnknown(CheckpointState)({
      schemaVersion: 3,
      lifecycleStatus: "active",
      classification: "non-trivial",
      classificationReason: "Bug fix",
      planCheckpoints: {
        "ged-planner": {
          recordedAt: "2026-05-17T10:00:00Z",
          source: "auto",
          valid: true,
        },
      },
      taskCheckpoints: {
        "task-1": {
          "ged-verifier": {
            recordedAt: "2026-05-17T11:00:00Z",
            source: "auto",
            valid: true,
            blocksCommit: false,
          },
        },
      },
    }),
  );

  it.effect("rejects unknown lifecycle status", () => {
    const decode = Schema.decodeUnknown(CheckpointState)({
      schemaVersion: 3,
      lifecycleStatus: "invalid",
      classification: "trivial",
      classificationReason: "test",
      planCheckpoints: {},
      taskCheckpoints: {},
    });
    return decode.pipe(import("effect/Effect").then((Effect) => Effect.flip));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter ged-workflow`
Expected: FAIL — `CheckpointSchema.ts` does not exist.

- [ ] **Step 3: Write CheckpointSchema implementation**

```typescript
// packages/ged-workflow/src/CheckpointSchema.ts
import * as Schema from "effect/Schema";

export const CheckpointSource = Schema.Literal("auto", "manual");
export type CheckpointSource = typeof CheckpointSource.Type;

export const CheckpointRecord = Schema.Struct({
  recordedAt: Schema.String,
  source: CheckpointSource,
  valid: Schema.Boolean,
  blocksCommit: Schema.optional(Schema.Boolean),
  summary: Schema.optional(Schema.String),
});
export type CheckpointRecord = typeof CheckpointRecord.Type;

export const SubagentName = Schema.Literal("ged-explorer", "ged-planner", "ged-verifier");
export type SubagentName = typeof SubagentName.Type;

export const LifecycleStatus = Schema.Literal("active", "verified", "closed");
export type LifecycleStatus = typeof LifecycleStatus.Type;

export const TaskClassification = Schema.Literal("trivial", "non-trivial");
export type TaskClassification = typeof TaskClassification.Type;

export const ClarificationRecord = Schema.Struct({
  completedAt: Schema.String,
  questionCount: Schema.Number,
});
export type ClarificationRecord = typeof ClarificationRecord.Type;

export const PlanCheckpoints = Schema.Record({
  key: Schema.Literal("ged-explorer", "ged-planner"),
  value: CheckpointRecord,
});

export const TaskCheckpoints = Schema.Record({
  key: Schema.String,
  value: Schema.Record({
    key: Schema.Literal("ged-explorer", "ged-verifier"),
    value: CheckpointRecord,
  }),
});

export const CheckpointState = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  lifecycleStatus: LifecycleStatus,
  classification: TaskClassification,
  classificationReason: Schema.String,
  clarification: Schema.optional(ClarificationRecord),
  planCheckpoints: PlanCheckpoints,
  taskCheckpoints: TaskCheckpoints,
});
export type CheckpointState = typeof CheckpointState.Type;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test --filter ged-workflow`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ged-workflow/src/CheckpointSchema.ts packages/ged-workflow/src/CheckpointSchema.test.ts
git commit -m "feat(ged-workflow): add checkpoint schema v3 types"
```

---

## Task 3: Implement CheckpointValidation (pure logic)

**Files:**

- Create: `packages/ged-workflow/src/CheckpointValidation.ts`
- Test: `packages/ged-workflow/src/CheckpointValidation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/ged-workflow/src/CheckpointValidation.test.ts
import { describe, it, expect } from "@effect/vitest";
import type { CheckpointState } from "./CheckpointSchema.ts";
import {
  validatePlannerCheckpoint,
  validateCommitCheckpoints,
  shouldAutoEscalate,
  invalidateVerifierCheckpoints,
  closeCheckpointState,
} from "./CheckpointValidation.ts";

const makeActiveState = (overrides?: Partial<CheckpointState>): CheckpointState => ({
  schemaVersion: 3,
  lifecycleStatus: "active",
  classification: "non-trivial",
  classificationReason: "test",
  planCheckpoints: {},
  taskCheckpoints: {},
  ...overrides,
});

describe("validatePlannerCheckpoint", () => {
  it("returns invalid when no planner checkpoint exists for non-trivial", () => {
    const result = validatePlannerCheckpoint(makeActiveState());
    expect(result.valid).toBe(false);
  });

  it("returns valid when planner checkpoint exists", () => {
    const result = validatePlannerCheckpoint(
      makeActiveState({
        planCheckpoints: {
          "ged-planner": {
            recordedAt: "2026-05-17T10:00:00Z",
            source: "auto",
            valid: true,
          },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("returns valid for trivial tasks regardless", () => {
    const result = validatePlannerCheckpoint(makeActiveState({ classification: "trivial" }));
    expect(result.valid).toBe(true);
  });
});

describe("validateCommitCheckpoints", () => {
  it("returns invalid when no verifier checkpoint for non-trivial", () => {
    const result = validateCommitCheckpoints(makeActiveState(), "task-1");
    expect(result.valid).toBe(false);
  });

  it("returns invalid when verifier checkpoint blocks commit", () => {
    const result = validateCommitCheckpoints(
      makeActiveState({
        taskCheckpoints: {
          "task-1": {
            "ged-verifier": {
              recordedAt: "2026-05-17T10:00:00Z",
              source: "auto",
              valid: true,
              blocksCommit: true,
            },
          },
        },
      }),
      "task-1",
    );
    expect(result.valid).toBe(false);
  });

  it("returns valid when verifier passes and does not block", () => {
    const result = validateCommitCheckpoints(
      makeActiveState({
        taskCheckpoints: {
          "task-1": {
            "ged-verifier": {
              recordedAt: "2026-05-17T10:00:00Z",
              source: "auto",
              valid: true,
              blocksCommit: false,
            },
          },
        },
      }),
      "task-1",
    );
    expect(result.valid).toBe(true);
  });

  it("returns valid for trivial tasks regardless", () => {
    const result = validateCommitCheckpoints(
      makeActiveState({ classification: "trivial" }),
      "task-1",
    );
    expect(result.valid).toBe(true);
  });
});

describe("shouldAutoEscalate", () => {
  it("returns true when trivial and >1 file touched", () => {
    expect(shouldAutoEscalate(makeActiveState({ classification: "trivial" }), 2)).toBe(true);
  });

  it("returns false when trivial and <=1 file touched", () => {
    expect(shouldAutoEscalate(makeActiveState({ classification: "trivial" }), 1)).toBe(false);
  });

  it("returns false when already non-trivial", () => {
    expect(shouldAutoEscalate(makeActiveState({ classification: "non-trivial" }), 5)).toBe(false);
  });
});

describe("invalidateVerifierCheckpoints", () => {
  it("marks all verifier checkpoints as invalid", () => {
    const state = makeActiveState({
      taskCheckpoints: {
        "task-1": {
          "ged-verifier": {
            recordedAt: "2026-05-17T10:00:00Z",
            source: "auto",
            valid: true,
          },
        },
      },
    });
    const result = invalidateVerifierCheckpoints(state);
    expect(result.taskCheckpoints["task-1"]?.["ged-verifier"]?.valid).toBe(false);
  });
});

describe("closeCheckpointState", () => {
  it("transitions lifecycle to closed", () => {
    const result = closeCheckpointState(makeActiveState());
    expect(result.lifecycleStatus).toBe("closed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter ged-workflow`
Expected: FAIL — `CheckpointValidation.ts` does not exist.

- [ ] **Step 3: Write CheckpointValidation implementation**

```typescript
// packages/ged-workflow/src/CheckpointValidation.ts
import type { CheckpointState } from "./CheckpointSchema.ts";

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export const validatePlannerCheckpoint = (state: CheckpointState): ValidationResult => {
  if (state.classification === "trivial") {
    return { valid: true };
  }
  const planner = state.planCheckpoints["ged-planner"];
  if (!planner || !planner.valid) {
    return {
      valid: false,
      reason:
        "Non-trivial task requires ged-planner checkpoint before source edits. Dispatch ged-planner first.",
    };
  }
  return { valid: true };
};

export const validateCommitCheckpoints = (
  state: CheckpointState,
  taskId: string,
): ValidationResult => {
  if (state.classification === "trivial") {
    return { valid: true };
  }
  const taskCps = state.taskCheckpoints[taskId];
  const verifier = taskCps?.["ged-verifier"];
  if (!verifier || !verifier.valid) {
    return {
      valid: false,
      reason: "Non-trivial commit requires ged-verifier checkpoint. Dispatch ged-verifier first.",
    };
  }
  if (verifier.blocksCommit) {
    return {
      valid: false,
      reason:
        "ged-verifier flagged blocksCommit=true. Resolve verifier findings before committing.",
    };
  }
  return { valid: true };
};

export const shouldAutoEscalate = (state: CheckpointState, filesChanged: number): boolean =>
  state.classification === "trivial" && filesChanged > 1;

export const invalidateVerifierCheckpoints = (state: CheckpointState): CheckpointState => {
  const updatedTaskCheckpoints: Record<
    string,
    Record<string, CheckpointState["taskCheckpoints"][string][string]>
  > = {};
  for (const [taskId, cps] of Object.entries(state.taskCheckpoints)) {
    const updatedCps: Record<string, CheckpointState["taskCheckpoints"][string][string]> = {};
    for (const [name, cp] of Object.entries(cps)) {
      updatedCps[name] = name === "ged-verifier" ? { ...cp, valid: false } : cp;
    }
    updatedTaskCheckpoints[taskId] = updatedCps;
  }
  return {
    ...state,
    taskCheckpoints: updatedTaskCheckpoints as CheckpointState["taskCheckpoints"],
  };
};

export const closeCheckpointState = (state: CheckpointState): CheckpointState => ({
  ...state,
  lifecycleStatus: "closed",
});

export const recordCheckpoint = (
  state: CheckpointState,
  location: "plan" | "task",
  name: string,
  taskId?: string,
): CheckpointState => {
  const record = {
    recordedAt: new Date().toISOString(),
    source: "auto" as const,
    valid: true,
  };
  if (location === "plan") {
    return {
      ...state,
      planCheckpoints: {
        ...state.planCheckpoints,
        [name]: record,
      } as CheckpointState["planCheckpoints"],
    };
  }
  const tid = taskId ?? "default";
  return {
    ...state,
    taskCheckpoints: {
      ...state.taskCheckpoints,
      [tid]: {
        ...(state.taskCheckpoints[tid] ?? {}),
        [name]: record,
      },
    } as CheckpointState["taskCheckpoints"],
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test --filter ged-workflow`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ged-workflow/src/CheckpointValidation.ts packages/ged-workflow/src/CheckpointValidation.test.ts
git commit -m "feat(ged-workflow): add checkpoint validation logic"
```

---

## Task 4: Implement .ged/ memory templates and bootstrap

**Files:**

- Create: `packages/ged-workflow/src/GedMemoryTemplates.ts`
- Create: `packages/ged-workflow/src/GedBootstrap.ts`
- Test: `packages/ged-workflow/src/GedBootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ged-workflow/src/GedBootstrap.test.ts
import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { bootstrapGedDirectory, isGedInitialized } from "./GedBootstrap.ts";

describe("GedBootstrap", () => {
  it.scoped("isGedInitialized returns false for missing .ged/", () =>
    Effect.gen(function* () {
      const result = yield* isGedInitialized("/nonexistent/path");
      expect(result).toBe(false);
    }).pipe(Effect.provide(import("effect/FileSystem").then((m) => m.FileSystem.Default))),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter ged-workflow`
Expected: FAIL — files don't exist.

- [ ] **Step 3: Write GedMemoryTemplates**

```typescript
// packages/ged-workflow/src/GedMemoryTemplates.ts
export const GED_DIRECTORY = ".ged";
export const GED_VERSION = "3";

export const TIER1_FILES: ReadonlyArray<{
  readonly path: string;
  readonly content: string;
}> = [
  {
    path: "VERSION",
    content: GED_VERSION,
  },
  {
    path: "PROJECT.md",
    content: `# Project\n\n> Goal, users, constraints, success criteria.\n> Fill this in during the onboarding interview.\n`,
  },
  {
    path: "ARCHITECTURE.md",
    content: `# Architecture\n\n> Component boundaries and system shape.\n> Updated as the codebase evolves.\n`,
  },
  {
    path: "PATTERNS.md",
    content: `# Patterns\n\n> Implementation conventions used in this project.\n`,
  },
  {
    path: "GLOSSARY.md",
    content: `# Glossary\n\n> Project and domain vocabulary.\n`,
  },
  {
    path: "DECISIONS.md",
    content: `# Decisions\n\n> Durable decisions and rationale (ADR-style).\n`,
  },
  {
    path: "STANDARDS.md",
    content: `# Standards\n\n> Imported repo-wide agent standards.\n`,
  },
  {
    path: "CONTEXT-MAP.md",
    content: `# Context Map\n\nThis directory uses the Ged memory model:\n\n- **Tier 1 (root)**: Durable project context, committed to version control.\n- **Tier 2 (work/)**: Per-branch active planning artifacts.\n- **Tier 3 (runtime/)**: Ephemeral session state, gitignored.\n`,
  },
];

export const TIER2_FILES: ReadonlyArray<{
  readonly path: string;
  readonly content: string;
}> = [
  {
    path: "SPEC.md",
    content: `# Spec\n\n> Current work-item contract. Fill before implementation.\n`,
  },
  {
    path: "TASKS.md",
    content: `# Tasks\n\n> Bounded implementation slices.\n`,
  },
  {
    path: "TESTS.md",
    content: `# Tests\n\n> Verification plan and evidence.\n`,
  },
  {
    path: "NOTES.md",
    content: `# Notes\n\n> Handoff notes for cross-session context.\n`,
  },
];

export const TIER3_FILES: ReadonlyArray<{
  readonly path: string;
  readonly content: string;
}> = [
  {
    path: "STATE.md",
    content: `# State\n\n- **Phase**: classify\n- **Active task**: none\n- **Blockers**: none\n- **Next step**: Classify the incoming request\n`,
  },
  {
    path: "SESSION-SUMMARY.md",
    content: `# Session Summary\n\n> Updated at end of each session for cross-session handoff.\n`,
  },
];

export const GED_GITIGNORE = `runtime/\n`;

export const INITIAL_CHECKPOINT_STATE = {
  schemaVersion: 3,
  lifecycleStatus: "active",
  classification: "trivial",
  classificationReason: "Awaiting first task classification",
  planCheckpoints: {},
  taskCheckpoints: {},
} as const;
```

- [ ] **Step 4: Write GedBootstrap**

```typescript
// packages/ged-workflow/src/GedBootstrap.ts
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  GED_DIRECTORY,
  GED_GITIGNORE,
  INITIAL_CHECKPOINT_STATE,
  TIER1_FILES,
  TIER2_FILES,
  TIER3_FILES,
} from "./GedMemoryTemplates.ts";

export const isGedInitialized = (
  projectRoot: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const versionPath = path.join(projectRoot, GED_DIRECTORY, "VERSION");
    return yield* fs.exists(versionPath);
  });

const writeIfMissing = (
  filePath: string,
  content: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath);
    if (!exists) {
      yield* fs.writeFileString(filePath, content);
    }
  });

export const bootstrapGedDirectory = (
  projectRoot: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const gedRoot = path.join(projectRoot, GED_DIRECTORY);
    const workDir = path.join(gedRoot, "work", "root");
    const runtimeDir = path.join(gedRoot, "runtime", "root");

    yield* fs.makeDirectory(gedRoot, { recursive: true });
    yield* fs.makeDirectory(workDir, { recursive: true });
    yield* fs.makeDirectory(runtimeDir, { recursive: true });

    for (const file of TIER1_FILES) {
      yield* writeIfMissing(path.join(gedRoot, file.path), file.content);
    }

    yield* writeIfMissing(path.join(gedRoot, ".gitignore"), GED_GITIGNORE);

    for (const file of TIER2_FILES) {
      yield* writeIfMissing(path.join(workDir, file.path), file.content);
    }

    for (const file of TIER3_FILES) {
      yield* writeIfMissing(path.join(runtimeDir, file.path), file.content);
    }

    yield* writeIfMissing(
      path.join(runtimeDir, "checkpoints.json"),
      JSON.stringify(INITIAL_CHECKPOINT_STATE, null, 2),
    );
  });
```

- [ ] **Step 5: Run tests**

Run: `bun run test --filter ged-workflow`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ged-workflow/src/GedMemoryTemplates.ts packages/ged-workflow/src/GedBootstrap.ts packages/ged-workflow/src/GedBootstrap.test.ts
git commit -m "feat(ged-workflow): add .ged/ memory templates and bootstrap logic"
```

---

## Task 5: Implement WorkflowPrompt (system prompt injection)

**Files:**

- Create: `packages/ged-workflow/src/WorkflowPrompt.ts`
- Test: `packages/ged-workflow/src/WorkflowPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ged-workflow/src/WorkflowPrompt.test.ts
import { describe, it, expect } from "@effect/vitest";
import { buildWorkflowPromptSuffix } from "./WorkflowPrompt.ts";

describe("WorkflowPrompt", () => {
  it("includes single-writer invariant", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("single-writer");
  });

  it("includes checkpoint requirements", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("checkpoint");
  });

  it("includes task classification rules", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("classify");
  });

  it("includes subagent orchestration when enabled", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: true });
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("ged-planner");
    expect(prompt).toContain("ged-verifier");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter ged-workflow`
Expected: FAIL

- [ ] **Step 3: Write WorkflowPrompt implementation**

```typescript
// packages/ged-workflow/src/WorkflowPrompt.ts
export interface WorkflowPromptOptions {
  readonly subagentsEnabled: boolean;
}

export const buildWorkflowPromptSuffix = (options: WorkflowPromptOptions): string => {
  const sections: string[] = [];

  sections.push(`## Ged Workflow

You operate under the Ged structured development workflow. Follow these rules strictly.

### Single-Writer Invariant
You are the single-writer agent. You own all active-worktree writes, scope decisions, verification judgments, commits, and PR decisions.

### Task Classification
Every incoming request MUST be classified before any work begins:
- **TRIVIAL**: Questions, config tweaks, comment edits, single-file formatting — no planning required.
- **NON-TRIVIAL**: Features, bug fixes, refactors, multi-file changes — full workflow required.

If a task classified as TRIVIAL touches >1 source file, it auto-escalates to NON-TRIVIAL.

### Workflow Pipeline (NON-TRIVIAL tasks)
1. **classify** — Determine trivial vs non-trivial
2. **clarify** — Ask clarifying questions one at a time (grill-me)
3. **plan** — Write SPEC.md, TASKS.md, TESTS.md in .ged/work/
4. **implement** — Execute bounded slices from TASKS.md
5. **verify** — Run verification checks, update checkpoint state
6. **commit** — Conventional commit format (feat:, fix:, refactor:, etc.)

### .ged/ Memory System
- Read .ged/work/root/STATE.md for current phase and active task
- Update STATE.md when transitioning between phases
- Record verification evidence in .ged/work/root/TESTS.md

### Checkpoint Requirements
- **Before source edits** (non-trivial): planning artifacts (SPEC.md, TASKS.md) must have real content — not placeholders
- **Before commits** (non-trivial): verification must be complete
- Source edits invalidate prior verification — re-verify before committing

### Conventional Commits
All commits must use the format: \`<type>: <description>\`
Types: feat, fix, refactor, docs, test, chore, perf, ci, build`);

  if (options.subagentsEnabled) {
    sections.push(`### Subagent Orchestration
Three read-only subagent roles are available for non-trivial work:
1. **ged-explorer** — Evidence-backed codebase discovery. Run BEFORE source file inspection.
2. **ged-planner** — Planning critique. Run BEFORE finalizing SPEC/TASKS/TESTS.
3. **ged-verifier** — Clean-context diff review. Run BEFORE committing.

Subagents are read-only — they cannot edit files. Only you (the primary agent) write code.`);
  }

  return sections.join("\n\n");
};
```

- [ ] **Step 4: Run tests**

Run: `bun run test --filter ged-workflow`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ged-workflow/src/WorkflowPrompt.ts packages/ged-workflow/src/WorkflowPrompt.test.ts
git commit -m "feat(ged-workflow): add workflow prompt suffix builder"
```

---

## Task 6: Implement SkillRegistry (bundled skill definitions)

**Files:**

- Create: `packages/ged-workflow/src/SkillRegistry.ts`

- [ ] **Step 1: Write SkillRegistry**

```typescript
// packages/ged-workflow/src/SkillRegistry.ts
export interface GedSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly autoInstall: boolean;
  readonly userTriggeredOnly: boolean;
}

export const BUNDLED_SKILLS: ReadonlyArray<GedSkillDefinition> = [
  {
    name: "grill-me",
    description:
      "Structured clarification before planning. Asks one question at a time with recommended answers.",
    autoInstall: true,
    userTriggeredOnly: false,
    content: `Ask clarifying questions one at a time before planning begins.

## Rules
1. Ask ONE question per turn — never batch questions.
2. Provide 2-4 recommended answers as options (the user can always type a custom answer).
3. Continue until you have enough context to write a clear SPEC.md.
4. When done, summarize what you learned and transition to planning phase.

## When to Use
- After classifying a task as NON-TRIVIAL
- Before writing SPEC.md or TASKS.md
- When the request is ambiguous or underspecified`,
  },
  {
    name: "ged-planning",
    description: "Write SPEC.md, TASKS.md, and TESTS.md with bounded implementation slices.",
    autoInstall: true,
    userTriggeredOnly: false,
    content: `Create the planning artifacts in .ged/work/root/.

## Steps
1. Write **SPEC.md** — Clear contract for what will be built. Include: goal, constraints, acceptance criteria.
2. Write **TASKS.md** — Bounded implementation slices. Each task should be completable in one focused session (2-15 minutes). Include verification criteria per task.
3. Write **TESTS.md** — Verification plan. What to test, how to test, expected outcomes.
4. Update **STATE.md** — Set phase to "implement", active task to first task.

## Constraints
- No placeholders — every artifact must have real content.
- Tasks must be ordered by dependency.
- Each task must be independently verifiable.`,
  },
  {
    name: "ged-execution",
    description: "Execute a single bounded task slice from TASKS.md.",
    autoInstall: true,
    userTriggeredOnly: false,
    content: `Implement the current active task from .ged/work/root/TASKS.md.

## Rules
1. Read STATE.md to find the active task.
2. Implement ONLY that task — no scope creep, no drive-by refactors.
3. After implementation, run verification (format, lint, typecheck, test).
4. Update STATE.md: mark task complete, set next task as active.
5. If verification fails, fix issues before moving on.

## Scope Guard
If you discover something that needs fixing outside the current task, add it as a new task in TASKS.md instead of fixing it now.`,
  },
  {
    name: "ged-verification",
    description: "Post-implementation verification and state update.",
    autoInstall: true,
    userTriggeredOnly: false,
    content: `Verify the implementation meets the spec and update checkpoint state.

## Steps
1. Run all project checks (format, lint, typecheck, test).
2. Review changes against SPEC.md acceptance criteria.
3. Record evidence in TESTS.md (which tests pass, what was manually verified).
4. Update STATE.md to reflect verification status.

## On Failure
If checks fail, fix the issues and re-verify. Do not commit until all checks pass.`,
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/ged-workflow/src/SkillRegistry.ts
git commit -m "feat(ged-workflow): add bundled skill definitions"
```

---

## Task 7: Add GedWorkflow contract types

**Files:**

- Create: `packages/contracts/src/gedWorkflow.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write contract schemas**

```typescript
// packages/contracts/src/gedWorkflow.ts
import * as Schema from "effect/Schema";

export const GedWorkflowPhase = Schema.Literal(
  "inactive",
  "classify",
  "clarify",
  "plan",
  "implement",
  "verify",
  "commit",
);
export type GedWorkflowPhase = typeof GedWorkflowPhase.Type;

export const GedTaskClassification = Schema.Literal("trivial", "non-trivial", "unclassified");
export type GedTaskClassification = typeof GedTaskClassification.Type;

export const GedWorkflowState = Schema.Struct({
  initialized: Schema.Boolean,
  phase: GedWorkflowPhase,
  classification: GedTaskClassification,
  activeTaskId: Schema.optional(Schema.String),
  plannerCheckpointValid: Schema.Boolean,
  verifierCheckpointValid: Schema.Boolean,
});
export type GedWorkflowState = typeof GedWorkflowState.Type;
```

- [ ] **Step 2: Export from contracts index**

Add to `packages/contracts/src/index.ts`:

```typescript
export * from "./gedWorkflow.ts";
```

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck --filter @t3tools/contracts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/gedWorkflow.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add GedWorkflow state schemas"
```

---

## Task 8: Create GedWorkflowService (server-side service)

**Files:**

- Create: `apps/server/src/gedWorkflow/Services/GedWorkflowService.ts`
- Create: `apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.ts`
- Test: `apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts`

- [ ] **Step 1: Write the service tag**

```typescript
// apps/server/src/gedWorkflow/Services/GedWorkflowService.ts
import type { GedWorkflowState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface GedWorkflowServiceShape {
  readonly bootstrap: (projectRoot: string) => Effect.Effect<void>;

  readonly getState: (projectRoot: string) => Effect.Effect<GedWorkflowState>;

  readonly getWorkflowPromptSuffix: (projectRoot: string) => Effect.Effect<string>;
}

export class GedWorkflowService extends Context.Service<
  GedWorkflowService,
  GedWorkflowServiceShape
>()("t3/gedWorkflow/Services/GedWorkflowService") {}
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts
import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { GedWorkflowService } from "../Services/GedWorkflowService.ts";
import { GedWorkflowServiceLive } from "./GedWorkflowServiceLive.ts";

describe("GedWorkflowServiceLive", () => {
  it.effect("getState returns inactive for uninitialized project", () =>
    Effect.gen(function* () {
      const service = yield* GedWorkflowService;
      const state = yield* service.getState("/nonexistent");
      expect(state.initialized).toBe(false);
      expect(state.phase).toBe("inactive");
    }).pipe(Effect.provide(GedWorkflowServiceLive)),
  );
});
```

- [ ] **Step 3: Write the live implementation**

```typescript
// apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.ts
import type { GedWorkflowState } from "@t3tools/contracts";
import { bootstrapGedDirectory, isGedInitialized } from "@t3tools/ged-workflow";
import { buildWorkflowPromptSuffix } from "@t3tools/ged-workflow/WorkflowPrompt";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { GedWorkflowService } from "../Services/GedWorkflowService.ts";

const readCheckpointState = (
  projectRoot: string,
): Effect.Effect<
  import("@t3tools/ged-workflow").CheckpointState | null,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cpPath = path.join(projectRoot, ".ged", "runtime", "root", "checkpoints.json");
    const exists = yield* fs.exists(cpPath);
    if (!exists) return null;
    const content = yield* fs.readFileString(cpPath);
    return JSON.parse(content);
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

const INACTIVE_STATE: GedWorkflowState = {
  initialized: false,
  phase: "inactive",
  classification: "unclassified",
  plannerCheckpointValid: false,
  verifierCheckpointValid: false,
};

export const GedWorkflowServiceLive = Layer.succeed(
  GedWorkflowService,
  GedWorkflowService.of({
    bootstrap: (projectRoot) =>
      bootstrapGedDirectory(projectRoot).pipe(
        Effect.provide(Layer.mergeAll(FileSystem.FileSystem.Default, Path.Path.layer)),
      ),

    getState: (projectRoot) =>
      Effect.gen(function* () {
        const initialized = yield* isGedInitialized(projectRoot);
        if (!initialized) return INACTIVE_STATE;

        const cp = yield* readCheckpointState(projectRoot);
        if (!cp) return { ...INACTIVE_STATE, initialized: true };

        const plannerCp = cp.planCheckpoints["ged-planner"];
        const hasVerifier = Object.values(cp.taskCheckpoints).some((task) => {
          const v = task["ged-verifier"];
          return v && v.valid && !v.blocksCommit;
        });

        return {
          initialized: true,
          phase: cp.lifecycleStatus === "closed" ? "commit" : "classify",
          classification:
            cp.classification === "trivial"
              ? "trivial"
              : cp.classification === "non-trivial"
                ? "non-trivial"
                : "unclassified",
          plannerCheckpointValid: plannerCp?.valid ?? false,
          verifierCheckpointValid: hasVerifier,
        } satisfies GedWorkflowState;
      }).pipe(Effect.provide(Layer.mergeAll(FileSystem.FileSystem.Default, Path.Path.layer))),

    getWorkflowPromptSuffix: (_projectRoot) =>
      Effect.succeed(buildWorkflowPromptSuffix({ subagentsEnabled: false })),
  }),
);
```

- [ ] **Step 4: Run test**

Run: `bun run test --filter server -- GedWorkflowServiceLive`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/gedWorkflow/
git commit -m "feat(server): add GedWorkflowService with bootstrap and state reading"
```

---

## Task 9: Create GedWorkflowTurnInterceptor (prompt injection)

**Files:**

- Create: `apps/server/src/gedWorkflow/Layers/GedWorkflowTurnInterceptor.ts`
- Modify: `apps/server/src/provider/Layers/ProviderService.ts`

This is the critical integration point. The interceptor wraps `ProviderService.sendTurn` to prepend the workflow prompt suffix to the user's message on the first turn of each session.

- [ ] **Step 1: Write the interceptor**

```typescript
// apps/server/src/gedWorkflow/Layers/GedWorkflowTurnInterceptor.ts
import type { ProviderSendTurnInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { GedWorkflowService } from "../Services/GedWorkflowService.ts";

const WORKFLOW_CONTEXT_MARKER = "[ged-workflow-context-injected]";

export const injectWorkflowContext = (
  input: ProviderSendTurnInput,
  projectRoot: string,
): Effect.Effect<ProviderSendTurnInput, never, GedWorkflowService> =>
  Effect.gen(function* () {
    const workflow = yield* GedWorkflowService;

    if (!input.input) return input;
    if (input.input.includes(WORKFLOW_CONTEXT_MARKER)) return input;

    const suffix = yield* workflow.getWorkflowPromptSuffix(projectRoot);
    if (!suffix) return input;

    return {
      ...input,
      input: `${input.input}\n\n---\n${WORKFLOW_CONTEXT_MARKER}\n${suffix}` as typeof input.input,
    };
  });
```

- [ ] **Step 2: Identify where to hook into ProviderServiceLive.sendTurn**

The injection happens in `apps/server/src/provider/Layers/ProviderService.ts` inside the `sendTurn` implementation. The interceptor is called before the turn is routed to the adapter.

Read ProviderServiceLive's `sendTurn` method to find the exact insertion point — it decodes input, then calls `adapter.sendTurn(decoded)`. The workflow context injection goes between decode and dispatch.

The cleanest approach: add an optional `GedWorkflowService` dependency to ProviderServiceLive using `Effect.serviceOption`, so it's non-breaking when not provided. When present, call `injectWorkflowContext` on the decoded input before dispatching.

- [ ] **Step 3: Modify ProviderServiceLive to accept optional GedWorkflowService**

In `apps/server/src/provider/Layers/ProviderService.ts`, inside the `sendTurn` function, after input decoding and before `adapter.sendTurn(decoded)`:

```typescript
// After decoding input, before dispatching to adapter:
const maybeWorkflow = yield * Effect.serviceOption(GedWorkflowService);
const finalInput =
  yield *
  Option.match(maybeWorkflow, {
    onNone: () => Effect.succeed(decoded),
    onSome: (workflow) => {
      const cwd = /* resolve from session binding */ binding.session?.cwd;
      if (!cwd) return Effect.succeed(decoded);
      return injectWorkflowContext(decoded, cwd).pipe(
        Effect.provideService(GedWorkflowService, workflow),
      );
    },
  });
```

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/gedWorkflow/Layers/GedWorkflowTurnInterceptor.ts apps/server/src/provider/Layers/ProviderService.ts
git commit -m "feat(server): inject Ged workflow context into provider turns"
```

---

## Task 10: Create GedWorkflowEventReactor (event processing)

**Files:**

- Create: `apps/server/src/gedWorkflow/Layers/GedWorkflowEventReactor.ts`

The reactor consumes `ProviderService.streamEvents` and reacts to:

- `item.completed` with file changes → invalidate verifier checkpoints
- `turn.completed` → update .ged/ STATE.md

- [ ] **Step 1: Write the reactor**

```typescript
// apps/server/src/gedWorkflow/Layers/GedWorkflowEventReactor.ts
import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import { invalidateVerifierCheckpoints, type CheckpointState } from "@t3tools/ged-workflow";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";

const readCheckpointFile = (
  checkpointPath: string,
): Effect.Effect<CheckpointState | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(checkpointPath);
    if (!exists) return null;
    const content = yield* fs.readFileString(checkpointPath);
    return JSON.parse(content) as CheckpointState;
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

const writeCheckpointFile = (
  checkpointPath: string,
  state: CheckpointState,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(checkpointPath, JSON.stringify(state, null, 2));
  });

const handleEvent = (
  event: ProviderRuntimeEvent,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path | ProviderSessionDirectory> =>
  Effect.gen(function* () {
    if (event.type !== "item.completed") return;

    const payload = event.payload as Record<string, unknown>;
    const itemType = payload?.itemType as string | undefined;
    if (itemType !== "file_change" && itemType !== "command") return;

    const threadId = event.threadId;
    if (!threadId) return;

    const sessionDir = yield* ProviderSessionDirectory;
    const binding = yield* sessionDir
      .resolve(threadId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (!binding) return;

    const cwd = (binding as { session?: { cwd?: string } }).session?.cwd;
    if (!cwd) return;

    const path = yield* Path.Path;
    const cpPath = path.join(cwd, ".ged", "runtime", "root", "checkpoints.json");
    const state = yield* readCheckpointFile(cpPath);
    if (!state || state.lifecycleStatus !== "active") return;

    const updated = invalidateVerifierCheckpoints(state);
    yield* writeCheckpointFile(cpPath, updated);
  }).pipe(Effect.catchAll(() => Effect.void));

export const GedWorkflowEventReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const providerService = yield* ProviderService;

    yield* providerService.streamEvents.pipe(Stream.runForEach(handleEvent), Effect.forkScoped);
  }),
);
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/gedWorkflow/Layers/GedWorkflowEventReactor.ts
git commit -m "feat(server): add Ged workflow event reactor for checkpoint invalidation"
```

---

## Task 11: Wire into server layer stack

**Files:**

- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Add @t3tools/ged-workflow dependency**

In `apps/server/package.json`, add to `dependencies`:

```json
"@t3tools/ged-workflow": "workspace:*"
```

- [ ] **Step 2: Import and wire layers in server.ts**

Add imports:

```typescript
import { GedWorkflowServiceLive } from "./gedWorkflow/Layers/GedWorkflowServiceLive.ts";
import { GedWorkflowEventReactorLive } from "./gedWorkflow/Layers/GedWorkflowEventReactor.ts";
```

Add to `ReactorLayerLive` (around line 142):

```typescript
const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(ThreadDeletionReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive),
  Layer.provideMerge(GedWorkflowEventReactorLive), // NEW
);
```

Add `GedWorkflowServiceLive` to `RuntimeCoreDependenciesLive` (around line 244):

```typescript
Layer.provideMerge(GedWorkflowServiceLive),  // NEW — after ProviderRuntimeLayerLive
```

- [ ] **Step 3: Run bun install and typecheck**

Run: `bun install && bun typecheck`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `bun run test`
Expected: PASS (existing tests unaffected)

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/src/server.ts
git commit -m "feat(server): wire GedWorkflowService and event reactor into layer stack"
```

---

## Task 12: Add workflow state WebSocket RPC endpoint

**Files:**

- Modify: `apps/server/src/ws.ts`

- [ ] **Step 1: Add RPC handler for workflow state**

Add a new RPC endpoint that the web UI can subscribe to for workflow state. This uses the same pattern as other RPC handlers in ws.ts — define the handler, add it to the route set.

The exact implementation depends on the existing RPC patterns in ws.ts. Read the file, find the pattern (likely `WsXxxRpc` definitions), and add:

- `WsGedWorkflowStateRpc` — returns current `GedWorkflowState` for a thread's project root
- Uses `GedWorkflowService.getState(cwd)` where `cwd` comes from the session binding

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ws.ts
git commit -m "feat(server): add WebSocket RPC endpoint for Ged workflow state"
```

---

## Task 13: Bundle skills as .claude/skills

**Files:**

- Create: `.claude/skills/grill-me/SKILL.md`
- Create: `.claude/skills/ged-planning/SKILL.md`
- Create: `.claude/skills/ged-execution/SKILL.md`
- Create: `.claude/skills/ged-verification/SKILL.md`

- [ ] **Step 1: Create skill files from SkillRegistry definitions**

Write each skill from `BUNDLED_SKILLS` as a `.claude/skills/<name>/SKILL.md`:

```yaml
# .claude/skills/grill-me/SKILL.md
---
name: grill-me
description: Structured clarification before planning. Asks one question at a time with recommended answers.
---

Ask clarifying questions one at a time before planning begins.

## Rules
1. Ask ONE question per turn — never batch questions.
2. Provide 2-4 recommended answers as options (the user can always type a custom answer).
3. Continue until you have enough context to write a clear SPEC.md.
4. When done, summarize what you learned and transition to planning phase.

## When to Use
- After classifying a task as NON-TRIVIAL
- Before writing SPEC.md or TASKS.md
- When the request is ambiguous or underspecified
```

Repeat for ged-planning, ged-execution, ged-verification using their content from SkillRegistry.ts.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/grill-me/ .claude/skills/ged-planning/ .claude/skills/ged-execution/ .claude/skills/ged-verification/
git commit -m "feat: bundle Ged workflow skills for Claude Code"
```

---

## Task 14: End-to-end verification

- [ ] **Step 1: Run format, lint, typecheck**

```bash
bun fmt && bun lint && bun typecheck
```

Expected: All pass.

- [ ] **Step 2: Run full test suite**

```bash
bun run test
```

Expected: All existing tests pass, new ged-workflow tests pass.

- [ ] **Step 3: Manual smoke test**

Start the dev server (`bun dev`), open the web UI, start a session with any provider. Verify:

1. First turn includes workflow context in the message (check server logs for the `[ged-workflow-context-injected]` marker)
2. The `.ged/` directory is bootstrapped in the project working directory when a session starts
3. Skills are available via `/grill-me`, `/ged-planning`, etc.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in e2e verification"
```

---

## Implementation Notes

### What this plan delivers

- **Provider-agnostic workflow injection**: The interceptor wraps `ProviderService.sendTurn`, so ALL providers (Codex, Claude, Cursor, OpenCode) get the workflow context automatically.
- **Zero-config .ged/ bootstrap**: `GedWorkflowService.bootstrap()` creates the full memory structure on first session.
- **Checkpoint validation library**: Pure functions that can enforce structural guards without provider-specific code.
- **Bundled skills**: Available in Claude Code sessions immediately.
- **Event-driven checkpoint invalidation**: File changes automatically invalidate verifier checkpoints.

### What's deferred to follow-up work

- **Web UI workflow status display**: The contract types and RPC endpoint are ready, but the React components (phase indicator, checkpoint badges) are a separate UI task.
- **Subagent orchestration**: The prompt supports it but actual subagent dispatch requires deeper integration per-provider.
- **Standards discovery/import**: Auto-detecting and importing AGENTS.md, .cursorrules, etc. into .ged/STANDARDS.md.
- **Per-branch work directories**: Currently uses `.ged/work/root/` — branch-specific isolation is a follow-up.
- **Hard enforcement (blocking tool calls)**: The current implementation uses prompt-based soft enforcement. Hard blocking (like GedPi's tool_call interception) requires provider-level hooks that aren't yet available in GedCode's adapter contract.
