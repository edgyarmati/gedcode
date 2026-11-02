import type { ClaudeSettings, ProviderInstanceEnvironment } from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as Effect from "effect/Effect";

import { readClaudeSettingsEntrypoint } from "./ClaudeSkills.ts";

/** Claude reads its entrypoint before applying settings `env`, so apply that override here. */
export const mergeClaudeProcessEnvironment = Effect.fn("mergeClaudeProcessEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  instanceEnvironment: ProviderInstanceEnvironment | undefined,
  hostEnvironment: NodeJS.ProcessEnv,
) {
  const environment = yield* mergeProviderInstanceEnvironment(instanceEnvironment, {
    ...hostEnvironment,
    CLAUDE_CODE_ENTRYPOINT: "t3-code",
  });
  const settingsEntrypoint = yield* readClaudeSettingsEntrypoint(config, environment);
  return settingsEntrypoint
    ? { ...environment, CLAUDE_CODE_ENTRYPOINT: settingsEntrypoint }
    : environment;
});
