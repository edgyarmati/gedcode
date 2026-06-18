import { InMemorySessionRepo, type AgentMessage } from "@earendil-works/pi-agent-core";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { findDanglingTailToolCalls, repairDanglingToolCalls } from "./SessionRepair.ts";

const timestamp = Date.parse("2026-06-14T10:00:00.000Z");

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const assistantWithToolCall: AgentMessage = {
  role: "assistant",
  content: [
    {
      type: "toolCall",
      id: "call-1",
      name: "start_worker_stage",
      arguments: { taskId: "task-1" },
    },
  ],
  api: "openai-responses",
  provider: "openai",
  model: "gpt-5.5",
  usage,
  stopReason: "toolUse",
  timestamp,
};

const toolResult: AgentMessage = {
  role: "toolResult",
  toolCallId: "call-1",
  toolName: "start_worker_stage",
  content: [{ type: "text", text: "started" }],
  isError: false,
  timestamp,
};

describe("SessionRepair", () => {
  it("detects only dangling tail tool calls", () => {
    assert.deepStrictEqual(findDanglingTailToolCalls([assistantWithToolCall]), [
      { id: "call-1", name: "start_worker_stage" },
    ]);
    assert.deepStrictEqual(findDanglingTailToolCalls([assistantWithToolCall, toolResult]), []);
    assert.deepStrictEqual(
      findDanglingTailToolCalls([
        assistantWithToolCall,
        { role: "user", content: "later message", timestamp },
      ]),
      [],
    );
  });

  it.effect("appends synthetic error tool results for dangling PM tool calls", () =>
    Effect.gen(function* () {
      const session = yield* Effect.promise(() => new InMemorySessionRepo().create());
      yield* Effect.promise(() => session.appendMessage(assistantWithToolCall));

      const repaired = yield* repairDanglingToolCalls({
        storage: session.getStorage(),
        reason: "test-repair",
      });
      const secondRepair = yield* repairDanglingToolCalls({
        storage: session.getStorage(),
        reason: "test-repair",
      });
      const context = yield* Effect.promise(() => session.buildContext());

      assert.strictEqual(repaired, 1);
      assert.strictEqual(secondRepair, 0);
      assert.strictEqual(context.messages.length, 2);
      assert.strictEqual(context.messages[1]?.role, "toolResult");
      if (context.messages[1]?.role === "toolResult") {
        assert.strictEqual(context.messages[1].toolCallId, "call-1");
        assert.strictEqual(context.messages[1].toolName, "start_worker_stage");
        assert.strictEqual(context.messages[1].isError, true);
        assert.match(
          context.messages[1].content[0]?.type === "text"
            ? context.messages[1].content[0].text
            : "",
          /interrupted/,
        );
      }
    }),
  );

  it.effect("does not append repairs for completed tool calls", () =>
    Effect.gen(function* () {
      const session = yield* Effect.promise(() => new InMemorySessionRepo().create());
      yield* Effect.promise(() => session.appendMessage(assistantWithToolCall));
      yield* Effect.promise(() => session.appendMessage(toolResult));

      const repaired = yield* repairDanglingToolCalls({
        storage: session.getStorage(),
        reason: "test-repair",
      });
      const context = yield* Effect.promise(() => session.buildContext());

      assert.strictEqual(repaired, 0);
      assert.strictEqual(context.messages.length, 2);
    }),
  );
});
