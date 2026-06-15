import type { AgentHarnessEvent, AgentHarnessOptions } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { DenyingExecutionEnv } from "./DenyingExecutionEnv.ts";
import { makePiAgentAdapter } from "./PiAgentAdapter.ts";

describe("PiAgentAdapter", () => {
  it.effect("tracks idle state from harness events without invoking a network model", () =>
    Effect.gen(function* () {
      const faux = registerFauxProvider();
      let listener: ((event: AgentHarnessEvent) => void | Promise<void>) | undefined;
      let unsubscribed = false;
      const prompts: string[] = [];

      const adapter = yield* makePiAgentAdapter({
        env: new DenyingExecutionEnv("/repo"),
        sessionStorage: {
          getMetadata: async () => ({ id: "session-1", createdAt: "2026-06-14T00:00:00.000Z" }),
          getLeafId: async () => null,
          setLeafId: async () => {},
          createEntryId: async () => "entry-1",
          appendEntry: async () => {},
          getEntry: async () => undefined,
          findEntries: async () => [],
          getLabel: async () => undefined,
          getPathToRoot: async () => [],
          getEntries: async () => [],
        },
        model: faux.getModel(),
        harnessFactory: (_options: AgentHarnessOptions) => ({
          prompt: async (text) => {
            prompts.push(text);
            return fauxAssistantMessage("ok");
          },
          followUp: async () => {},
          compact: async () => ({
            summary: "summary",
            firstKeptEntryId: "entry-1",
            tokensBefore: 1,
          }),
          abort: async () => {},
          waitForIdle: async () => {},
          setResources: async () => {},
          subscribe: (next) => {
            listener = next;
            return () => {
              unsubscribed = true;
            };
          },
        }),
      });

      assert.strictEqual(yield* adapter.isIdle, true);

      listener?.({ type: "agent_start" });
      assert.strictEqual(yield* adapter.isIdle, false);

      listener?.({ type: "settled", nextTurnCount: 0 });
      assert.strictEqual(yield* adapter.isIdle, true);

      yield* adapter.abort;
      assert.strictEqual(unsubscribed, true);
      assert.deepStrictEqual(prompts, []);

      faux.unregister();
    }),
  );
});
