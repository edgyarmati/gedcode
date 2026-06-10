import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId, ServerSettingsError } from "@t3tools/contracts";
import {
  CheckpointState,
  type CheckpointState as CheckpointStateValue,
} from "@t3tools/ged-workflow/CheckpointSchema";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
import type { GedWorkflowPromptContext } from "../Services/GedWorkflowService.ts";
import { GedWorkflowService } from "../Services/GedWorkflowService.ts";
import { GedWorkflowServiceLive } from "./GedWorkflowServiceLive.ts";

const runPrompt = (
  settingsOverrides: Parameters<typeof ServerSettingsService.layerTest>[0] = {},
  context?: GedWorkflowPromptContext,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* GedWorkflowService;
      return yield* service.getWorkflowPromptSuffix(context);
    }).pipe(
      Effect.provide(
        Layer.provide(
          GedWorkflowServiceLive,
          Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest(settingsOverrides)),
        ),
      ),
    ),
  );

const checkpointStateJsonCodec = Schema.fromJsonString(CheckpointState);
const encodeCheckpointStateJson = Schema.encodeSync(checkpointStateJsonCodec);
const decodeCheckpointStateJson = Schema.decodeSync(checkpointStateJsonCodec);
const TEST_THREAD_ID = "thread-test";

const threadCheckpointPaths = (path: Path.Path, projectRoot: string, threadId: string) => {
  const threadDir = path.join(
    projectRoot,
    ".ged",
    "runtime",
    "root",
    "threads",
    encodeURIComponent(threadId),
  );
  return {
    checkpointsDir: threadDir,
    checkpointsPath: path.join(threadDir, "checkpoints.json"),
    trustedCheckpointsPath: path.join(threadDir, "checkpoints.trusted.json"),
  };
};

const runGetState = (checkpointState: CheckpointStateValue) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectRoot = yield* fs.makeTempDirectoryScoped({
          prefix: "ged-workflow-state-",
        });
        const { checkpointsDir, checkpointsPath } = threadCheckpointPaths(
          path,
          projectRoot,
          TEST_THREAD_ID,
        );
        yield* fs.makeDirectory(checkpointsDir, { recursive: true });
        yield* fs.writeFileString(checkpointsPath, encodeCheckpointStateJson(checkpointState));

        return yield* Effect.gen(function* () {
          const service = yield* GedWorkflowService;
          return yield* service.getState(projectRoot, { threadId: TEST_THREAD_ID });
        }).pipe(
          Effect.provide(
            Layer.provide(
              GedWorkflowServiceLive,
              Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest()),
            ),
          ),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );

describe("GedWorkflowServiceLive", () => {
  it("builds harness-native subagent prompt suffix from settings", async () => {
    const prompt = await runPrompt();
    expect(prompt).toContain("### Ged Role Execution");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("native subagent; main agent waits for structured evidence");
    expect(prompt).toContain("before any local source inspection");
  });

  it("falls back to main-thread role execution when subagents are disabled", async () => {
    const prompt = await runPrompt({ gedSubagentsEnabled: false });
    expect(prompt).toContain("### Ged Role Execution");
    expect(prompt).toContain("main-thread fallback");
    expect(prompt).toContain('source: "main"');
    expect(prompt).not.toContain("### Codex Ged Subagent Preset");
  });

  it("passes role settings into the prompt suffix", async () => {
    const prompt = await runPrompt({
      gedRoleSettings: {
        "ged-explorer": { enabled: false },
        "ged-planner": { enabled: true },
        "ged-verifier": { enabled: true },
      },
    });

    expect(prompt).toContain(
      "**ged-explorer** (Explorer): main-thread fallback; main agent performs this role",
    );
    expect(prompt).toContain(
      "**ged-planner** (Planner): native subagent; main agent waits for structured evidence",
    );
  });

  it("adds Codex Ged subagent preset for Codex prompts", async () => {
    const prompt = await runPrompt(
      {
        providers: {
          codex: {
            gedSubagentPreset: {
              "ged-explorer": { model: "gpt-5.4-mini", reasoning: "medium" },
              "ged-planner": { model: "gpt-5.5", reasoning: "xhigh" },
              "ged-verifier": { model: "gpt-5.5", reasoning: "low" },
            },
          },
        },
      },
      {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
    );

    expect(prompt).toContain("### Codex Ged Subagent Preset");
    expect(prompt).toContain("ged-explorer: model=gpt-5.4-mini, reasoning=medium");
    expect(prompt).toContain("Pass the listed `model` as the Codex native subagent tool");
    expect(prompt).toContain("reasoning-effort override");
  });

  it("omits Codex Ged subagent preset for non-Codex prompts", async () => {
    const prompt = await runPrompt(
      {
        providers: {
          codex: {
            gedSubagentPreset: {
              "ged-explorer": { model: "gpt-5.4-mini", reasoning: "medium" },
              "ged-planner": { model: "gpt-5.5", reasoning: "xhigh" },
              "ged-verifier": { model: "gpt-5.5", reasoning: "xhigh" },
            },
          },
        },
      },
      {
        provider: ProviderDriverKind.make("opencode"),
        providerInstanceId: ProviderInstanceId.make("opencode"),
      },
    );

    expect(prompt).not.toContain("### Codex Ged Subagent Preset");
    expect(prompt).not.toContain("ged-verifier: model=gpt-5.5, reasoning=xhigh");
  });

  it("prefers Codex provider instance preset over the default Codex preset", async () => {
    const customInstanceId = ProviderInstanceId.make("codex_work");
    const prompt = await runPrompt(
      {
        providers: {
          codex: {
            gedSubagentPreset: {
              "ged-explorer": { model: "gpt-5.4-mini", reasoning: "medium" },
              "ged-planner": { model: "gpt-5.4", reasoning: "high" },
              "ged-verifier": { model: "gpt-5.5", reasoning: "low" },
            },
          },
        },
        providerInstances: {
          [customInstanceId]: {
            driver: ProviderDriverKind.make("codex"),
            config: {
              gedSubagentPreset: {
                "ged-explorer": { model: "gpt-5.4-mini", reasoning: "medium" },
                "ged-planner": { model: "gpt-5.5", reasoning: "xhigh" },
                "ged-verifier": { model: "gpt-5.5", reasoning: "xhigh" },
              },
            },
          },
        },
      },
      { provider: ProviderDriverKind.make("codex"), providerInstanceId: customInstanceId },
    );

    expect(prompt).toContain("ged-verifier: model=gpt-5.5, reasoning=xhigh");
    expect(prompt).not.toContain("ged-planner: model=gpt-5.4, reasoning=high");
  });

  it("falls back to harness-native prompt defaults when settings cannot be read", async () => {
    const failingSettings = {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.fail(
        new ServerSettingsError({ settingsPath: "<test>", detail: "settings unavailable" }),
      ),
      updateSettings: () =>
        Effect.fail(
          new ServerSettingsError({ settingsPath: "<test>", detail: "settings unavailable" }),
        ),
      streamChanges: Stream.empty,
    } satisfies ServerSettingsShape;

    const prompt = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* GedWorkflowService;
        return yield* service.getWorkflowPromptSuffix();
      }).pipe(
        Effect.provide(
          Layer.provide(
            GedWorkflowServiceLive,
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(ServerSettingsService, failingSettings),
            ),
          ),
        ),
      ),
    );

    expect(prompt).toContain("### Ged Role Execution");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("native subagent; main agent waits for structured evidence");
  });

  it("runs non-trivial heuristics after resetting a closed lifecycle", async () => {
    const updated = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "ged-workflow-classify-",
          });
          const { checkpointsDir, checkpointsPath, trustedCheckpointsPath } = threadCheckpointPaths(
            path,
            projectRoot,
            TEST_THREAD_ID,
          );
          yield* fs.makeDirectory(checkpointsDir, { recursive: true });
          yield* fs.writeFileString(
            checkpointsPath,
            encodeCheckpointStateJson({
              schemaVersion: 3,
              lifecycleStatus: "closed",
              classification: "non-trivial",
              classificationReason: "previous task",
              planCheckpoints: {
                "ged-planner": {
                  recordedAt: "2026-06-01T00:00:00.000Z",
                  source: "auto",
                  valid: true,
                },
              },
              taskCheckpoints: {
                "task-1": {
                  "ged-verifier": {
                    recordedAt: "2026-06-01T00:00:00.000Z",
                    source: "auto",
                    valid: true,
                  },
                },
              },
            } satisfies CheckpointStateValue),
          );

          yield* Effect.gen(function* () {
            const service = yield* GedWorkflowService;
            yield* service.classifyTurn(
              projectRoot,
              "replace DeepSeek with Gemini 3.1 Flash Lite",
              {
                threadId: TEST_THREAD_ID,
              },
            );
          }).pipe(
            Effect.provide(
              Layer.provide(
                GedWorkflowServiceLive,
                Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest()),
              ),
            ),
          );

          return {
            checkpoint: decodeCheckpointStateJson(yield* fs.readFileString(checkpointsPath)),
            trustedCheckpoint: decodeCheckpointStateJson(
              yield* fs.readFileString(trustedCheckpointsPath),
            ),
          };
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    );

    expect(updated.checkpoint.lifecycleStatus).toBe("active");
    expect(updated.checkpoint.classification).toBe("non-trivial");
    expect(updated.checkpoint.classificationReason).toBe(
      "Server-side heuristic: turn input matched non-trivial signals.",
    );
    expect(updated.checkpoint.planCheckpoints).toEqual({});
    expect(updated.checkpoint.taskCheckpoints).toEqual({});
    expect(updated.trustedCheckpoint).toEqual(updated.checkpoint);
  });

  it("keeps thread checkpoint state independent across threads", async () => {
    const updated = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "ged-workflow-new-thread-",
          });

          yield* Effect.gen(function* () {
            const service = yield* GedWorkflowService;
            yield* service.classifyTurn(projectRoot, "continue implementing the feature", {
              threadId: "thread-old",
            });
            yield* service.classifyTurn(projectRoot, "what is 2+2?", { threadId: "thread-new" });
          }).pipe(
            Effect.provide(
              Layer.provide(
                GedWorkflowServiceLive,
                Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest()),
              ),
            ),
          );

          const oldPaths = threadCheckpointPaths(path, projectRoot, "thread-old");
          const newPaths = threadCheckpointPaths(path, projectRoot, "thread-new");
          return {
            oldCheckpoint: decodeCheckpointStateJson(
              yield* fs.readFileString(oldPaths.checkpointsPath),
            ),
            newCheckpoint: decodeCheckpointStateJson(
              yield* fs.readFileString(newPaths.checkpointsPath),
            ),
            newTrustedCheckpoint: decodeCheckpointStateJson(
              yield* fs.readFileString(newPaths.trustedCheckpointsPath),
            ),
          };
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    );

    expect(updated.oldCheckpoint.classification).toBe("non-trivial");
    expect(updated.oldCheckpoint.classificationReason).toBe(
      "Server-side heuristic: turn input matched non-trivial signals.",
    );
    expect(updated.newCheckpoint.lifecycleStatus).toBe("active");
    expect(updated.newCheckpoint.classification).toBe("trivial");
    expect(updated.newCheckpoint.classificationReason).toBe("Awaiting first task classification");
    expect(updated.newCheckpoint.planCheckpoints).toEqual({});
    expect(updated.newCheckpoint.taskCheckpoints).toEqual({});
    expect(updated.newTrustedCheckpoint).toEqual(updated.newCheckpoint);
  });

  it("ignores project-level checkpoint files when reading thread state", async () => {
    const state = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projectRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "ged-workflow-ignore-project-",
          });
          const runtimeDir = path.join(projectRoot, ".ged", "runtime", "root");
          yield* fs.makeDirectory(runtimeDir, { recursive: true });
          yield* fs.writeFileString(
            path.join(runtimeDir, "checkpoints.json"),
            encodeCheckpointStateJson({
              schemaVersion: 3,
              lifecycleStatus: "active",
              classification: "non-trivial",
              classificationReason: "stale project checkpoint",
              planCheckpoints: {},
              taskCheckpoints: {},
            } satisfies CheckpointStateValue),
          );

          return yield* Effect.gen(function* () {
            const service = yield* GedWorkflowService;
            return yield* service.getState(projectRoot, { threadId: TEST_THREAD_ID });
          }).pipe(
            Effect.provide(
              Layer.provide(
                GedWorkflowServiceLive,
                Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest()),
              ),
            ),
          );
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    );

    expect(state.classification).toBe("trivial");
    expect(state.phase).toBe("classify");
  });

  it.each([
    [
      "trivial active checkpoints as classify",
      {
        schemaVersion: 3,
        lifecycleStatus: "active",
        classification: "trivial",
        classificationReason: "question",
        planCheckpoints: {},
        taskCheckpoints: {},
      } satisfies CheckpointStateValue,
      "classify",
    ],
    [
      "non-trivial without clarification as clarify",
      {
        schemaVersion: 3,
        lifecycleStatus: "active",
        classification: "non-trivial",
        classificationReason: "feature request",
        planCheckpoints: {},
        taskCheckpoints: {},
      } satisfies CheckpointStateValue,
      "clarify",
    ],
    [
      "non-trivial with clarification before planner as plan",
      {
        schemaVersion: 3,
        lifecycleStatus: "active",
        classification: "non-trivial",
        classificationReason: "feature request",
        clarification: {
          completedAt: "2026-06-09T00:00:00.000Z",
          decision: "skipped-sufficient",
          questionCount: 0,
          reason: "test has enough context",
        },
        planCheckpoints: {},
        taskCheckpoints: {},
      } satisfies CheckpointStateValue,
      "plan",
    ],
    [
      "valid planner before verifier as implement",
      {
        schemaVersion: 3,
        lifecycleStatus: "active",
        classification: "non-trivial",
        classificationReason: "feature request",
        clarification: {
          completedAt: "2026-06-09T00:00:00.000Z",
          decision: "skipped-sufficient",
          questionCount: 0,
          reason: "test has enough context",
        },
        planCheckpoints: {
          "ged-planner": {
            recordedAt: "2026-06-09T00:00:00.000Z",
            source: "auto",
            valid: true,
          },
        },
        taskCheckpoints: {},
      } satisfies CheckpointStateValue,
      "implement",
    ],
    [
      "valid verifier as inferred done",
      {
        schemaVersion: 3,
        lifecycleStatus: "active",
        classification: "non-trivial",
        classificationReason: "feature request",
        clarification: {
          completedAt: "2026-06-09T00:00:00.000Z",
          decision: "skipped-sufficient",
          questionCount: 0,
          reason: "test has enough context",
        },
        planCheckpoints: {
          "ged-planner": {
            recordedAt: "2026-06-09T00:00:00.000Z",
            source: "auto",
            valid: true,
          },
        },
        taskCheckpoints: {
          "task-1": {
            "ged-verifier": {
              recordedAt: "2026-06-09T00:00:00.000Z",
              source: "auto",
              valid: true,
            },
          },
        },
      } satisfies CheckpointStateValue,
      "done",
    ],
    [
      "closed lifecycle as done",
      {
        schemaVersion: 3,
        lifecycleStatus: "closed",
        classification: "trivial",
        classificationReason: "complete",
        planCheckpoints: {},
        taskCheckpoints: {},
      } satisfies CheckpointStateValue,
      "done",
    ],
  ])("maps %s", async (_name, checkpointState, expectedPhase) => {
    const state = await runGetState(checkpointState);
    expect(state.phase).toBe(expectedPhase);
  });
});
