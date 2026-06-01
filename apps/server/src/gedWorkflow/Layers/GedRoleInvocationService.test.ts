import { ThreadId, type OrchestrationCommand } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  GedRoleInvocationService,
  type GedRoleInvocationInput,
} from "../Services/GedRoleInvocationService.ts";
import { GedRoleInvocationServiceLive } from "./GedRoleInvocationServiceLive.ts";

const parentThreadId = ThreadId.make("thread-parent");

const runWith = async (
  commands: OrchestrationCommand[],
  settingsOverrides: Parameters<typeof ServerSettingsService.layerTest>[0] = {},
  inputOverrides: Partial<GedRoleInvocationInput> = {},
) => {
  const engine: OrchestrationEngineShape = {
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: commands.length };
      }),
  };

  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* GedRoleInvocationService;
      return yield* service.invoke({
        role: "ged-explorer",
        invocationId: "inv-1",
        parentThreadId,
        request: "Inspect orchestration seams",
        ...inputOverrides,
      });
    }).pipe(
      Effect.provide(
        Layer.provide(
          GedRoleInvocationServiceLive,
          Layer.mergeAll(
            Layer.succeed(OrchestrationEngineService, engine),
            Layer.succeed(ProjectionSnapshotQuery, {} as never),
            ServerSettingsService.layerTest(settingsOverrides),
          ),
        ),
      ),
    ),
  );
};

describe("GedRoleInvocationServiceLive", () => {
  it("does not dispatch Gedcode-managed role child threads", async () => {
    const commands: OrchestrationCommand[] = [];
    await expect(runWith(commands)).rejects.toMatchObject({
      _tag: "GedRoleInvocationInputError",
      detail: "Ged role child threads are disabled; use harness-native subagents",
    });
    expect(commands).toEqual([]);
  });

  it("still reports globally disabled subagents before harness-native refusal", async () => {
    const commands: OrchestrationCommand[] = [];
    await expect(runWith(commands, { gedSubagentsEnabled: false })).rejects.toMatchObject({
      _tag: "GedRoleInvocationInputError",
      detail: "Ged subagents are disabled",
    });
    expect(commands).toEqual([]);
  });

  it("validates invocation ids before consulting runtime settings", async () => {
    const commands: OrchestrationCommand[] = [];
    await expect(runWith(commands, {}, { invocationId: "bad id" })).rejects.toMatchObject({
      _tag: "GedRoleInvocationInputError",
    });
    expect(commands).toEqual([]);
  });
});
