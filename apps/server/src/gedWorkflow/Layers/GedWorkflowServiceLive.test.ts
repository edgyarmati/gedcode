import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerSettingsError } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
import { GedWorkflowService } from "../Services/GedWorkflowService.ts";
import { GedWorkflowServiceLive } from "./GedWorkflowServiceLive.ts";

const runPrompt = (settingsOverrides: Parameters<typeof ServerSettingsService.layerTest>[0] = {}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* GedWorkflowService;
      return yield* service.getWorkflowPromptSuffix();
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
  it("builds managed subagent prompt suffix from settings", async () => {
    const prompt = await runPrompt();
    expect(prompt).toContain("### Subagent Orchestration");
    expect(prompt).toContain("ged-explorer");
  });

  it("omits subagent instructions when subagents are disabled", async () => {
    const prompt = await runPrompt({ gedSubagentsEnabled: false });
    expect(prompt).not.toContain("### Subagent Orchestration");
    expect(prompt).not.toContain("### Harness-Native Subagent Orchestration");
  });

  it("builds harness-native subagent prompt suffix from settings", async () => {
    const prompt = await runPrompt({ gedSubagentRuntimeMode: "harness-native" });
    expect(prompt).toContain("### Harness-Native Subagent Orchestration");
    expect(prompt).toContain("provider-native subagent");
    expect(prompt).not.toContain("Subagents are read-only");
  });

  it("falls back to managed prompt defaults when settings cannot be read", async () => {
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

    expect(prompt).toContain("### Subagent Orchestration");
    expect(prompt).toContain("ged-explorer");
  });
});
