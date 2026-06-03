import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId, ServerSettingsError } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

describe("GedWorkflowServiceLive", () => {
  it("builds harness-native subagent prompt suffix from settings", async () => {
    const prompt = await runPrompt();
    expect(prompt).toContain("### Harness-Native Subagent Orchestration");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("native subagents were unavailable");
  });

  it("omits subagent instructions when subagents are disabled", async () => {
    const prompt = await runPrompt({ gedSubagentsEnabled: false });
    expect(prompt).not.toContain("### Subagent Orchestration");
    expect(prompt).not.toContain("### Harness-Native Subagent Orchestration");
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

    expect(prompt).toContain("### Harness-Native Subagent Orchestration");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("native subagents were unavailable");
  });
});
