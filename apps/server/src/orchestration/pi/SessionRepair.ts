import type {
  AgentMessage,
  SessionMetadata,
  SessionStorage,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { toPmRuntimeError, type PmRuntimeError } from "./Errors.ts";

type DanglingToolCall = Pick<ToolCall, "id" | "name">;

const isMessageEntry = (
  entry: SessionTreeEntry,
): entry is Extract<SessionTreeEntry, { type: "message" }> => entry.type === "message";

const toolCallsFromAssistant = (message: AgentMessage): DanglingToolCall[] => {
  if (message.role !== "assistant") {
    return [];
  }
  return message.content
    .filter((content): content is ToolCall => content.type === "toolCall")
    .map((content) => ({ id: content.id, name: content.name }));
};

export const findDanglingTailToolCalls = (
  messages: ReadonlyArray<AgentMessage>,
): ReadonlyArray<DanglingToolCall> => {
  const pending = new Map<string, DanglingToolCall>();
  let repairable = true;

  for (const message of messages) {
    if (message.role === "assistant") {
      pending.clear();
      for (const toolCall of toolCallsFromAssistant(message)) {
        pending.set(toolCall.id, toolCall);
      }
      repairable = true;
      continue;
    }

    if (message.role === "toolResult") {
      pending.delete(message.toolCallId);
      continue;
    }

    if (pending.size > 0) {
      repairable = false;
    }
  }

  return repairable ? [...pending.values()] : [];
};

const makeInterruptedToolResult = (input: {
  readonly toolCall: DanglingToolCall;
  readonly repairedAt: string;
  readonly reason: string;
}): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: input.toolCall.id,
  toolName: input.toolCall.name,
  content: [
    {
      type: "text",
      text:
        "This tool call was interrupted before GedCode recorded a durable result. " +
        "Treat it as not executed and inspect the current orchestrator task state before continuing.",
    },
  ],
  details: {
    source: "gedcode.pm-runtime-session-repair",
    reason: input.reason,
    repairedAt: input.repairedAt,
  },
  isError: true,
  timestamp: Date.parse(input.repairedAt),
});

export const repairDanglingToolCalls = <TMetadata extends SessionMetadata>(input: {
  readonly storage: SessionStorage<TMetadata>;
  readonly reason: string;
}): Effect.Effect<number, PmRuntimeError> =>
  Effect.gen(function* () {
    const leafId = yield* Effect.tryPromise({
      try: () => input.storage.getLeafId(),
      catch: toPmRuntimeError(
        "SessionRepair.getLeafId",
        "Failed to read PM session leaf while repairing dangling tool calls.",
      ),
    });
    const path = yield* Effect.tryPromise({
      try: () => input.storage.getPathToRoot(leafId),
      catch: toPmRuntimeError(
        "SessionRepair.getPathToRoot",
        "Failed to read PM session path while repairing dangling tool calls.",
      ),
    });
    const messages = path.filter(isMessageEntry).map((entry) => entry.message);
    const danglingToolCalls = findDanglingTailToolCalls(messages);
    if (danglingToolCalls.length === 0) {
      return 0;
    }

    for (const toolCall of danglingToolCalls) {
      const repairedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      const parentId = yield* Effect.tryPromise({
        try: () => input.storage.getLeafId(),
        catch: toPmRuntimeError(
          "SessionRepair.getLeafId",
          "Failed to read PM session leaf before appending a repaired tool result.",
        ),
      });
      const id = yield* Effect.tryPromise({
        try: () => input.storage.createEntryId(),
        catch: toPmRuntimeError(
          "SessionRepair.createEntryId",
          "Failed to allocate PM session entry id for repaired tool result.",
        ),
      });
      yield* Effect.tryPromise({
        try: () =>
          input.storage.appendEntry({
            type: "message",
            id,
            parentId,
            timestamp: repairedAt,
            message: makeInterruptedToolResult({
              toolCall,
              repairedAt,
              reason: input.reason,
            }),
          }),
        catch: toPmRuntimeError(
          "SessionRepair.appendEntry",
          "Failed to append repaired PM tool result.",
        ),
      });
    }

    return danglingToolCalls.length;
  });
