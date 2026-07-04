import type {
  AgentHarnessEvent,
  AgentHarnessResources,
  CompactResult,
} from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  Model,
  TextContent,
  Usage,
} from "@earendil-works/pi-ai";
import {
  type ModelSelection,
  type OrchestrationProject,
  type ProviderRuntimeEvent,
  type ThreadTokenUsageSnapshot,
  type TurnId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { ClaudeAdapterShape } from "../../provider/Services/ClaudeAdapter.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import { PmRuntimeError, toPmRuntimeError } from "../pi/Errors.ts";
import type { PiAgentAdapterShape } from "../pi/PiAgentAdapter.ts";
import { pmThreadIdForProject } from "../pi/PmEventProjection.ts";
import { CLAUDE_PM_DRIVER } from "./constants.ts";
import { ORCHESTRATION_MCP_SERVER_NAME } from "./pmMcpServer.ts";

const CLAUDE_PROVIDER = CLAUDE_PM_DRIVER;

const zeroUsage = (): Usage => ({
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
});

const assistantMessage = (input: {
  readonly text: string;
  readonly model: string;
  readonly usage?: Usage | undefined;
  readonly stopReason?: AssistantMessage["stopReason"];
  readonly errorMessage?: string | undefined;
}): AssistantMessage => ({
  role: "assistant",
  content: input.text.length > 0 ? [{ type: "text", text: input.text }] : [],
  api: "anthropic-messages",
  provider: "anthropic",
  model: input.model,
  usage: input.usage ?? zeroUsage(),
  stopReason: input.stopReason ?? "stop",
  ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  timestamp: 0,
});

const textContent = (text: string): TextContent => ({ type: "text", text });

const usageFromSnapshot = (snapshot: ThreadTokenUsageSnapshot): Usage => {
  const input = snapshot.lastInputTokens ?? snapshot.inputTokens ?? 0;
  const output = snapshot.lastOutputTokens ?? snapshot.outputTokens ?? 0;
  const cacheRead = snapshot.lastCachedInputTokens ?? snapshot.cachedInputTokens ?? 0;
  const totalTokens = snapshot.lastUsedTokens ?? snapshot.usedTokens ?? input + output + cacheRead;
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const lifecycleToolData = (
  payload: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >["payload"],
):
  | {
      readonly toolName: string;
      readonly input: Record<string, unknown>;
      readonly result?: unknown;
    }
  | undefined => {
  if (!isRecord(payload.data)) {
    return undefined;
  }
  const toolName = typeof payload.data.toolName === "string" ? payload.data.toolName : undefined;
  if (!toolName) {
    return undefined;
  }
  const input = isRecord(payload.data.input) ? payload.data.input : {};
  return {
    toolName,
    input,
    ...("result" in payload.data ? { result: payload.data.result } : {}),
  };
};

const orchestrationToolName = (toolName: string): string | undefined => {
  const prefix = `mcp__${ORCHESTRATION_MCP_SERVER_NAME}__`;
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : undefined;
};

const resultText = (result: unknown, fallback: string): string => {
  if (typeof result === "string") {
    return result;
  }
  if (isRecord(result) && Array.isArray(result.content)) {
    return result.content
      .map((entry) =>
        isRecord(entry) && entry.type === "text" && typeof entry.text === "string"
          ? entry.text
          : "",
      )
      .join("");
  }
  return fallback;
};

type ActiveAssistant = {
  readonly turnId: TurnId | undefined;
  readonly contentIndex: number;
  readonly started: boolean;
  readonly completed: boolean;
  readonly text: string;
};

type ActiveTool = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly includeResultDetails: boolean;
};

export interface DriverPmAdapterOptions {
  readonly project: OrchestrationProject;
  readonly claudeAdapter: ClaudeAdapterShape;
  readonly modelSelection: ModelSelection;
  readonly systemPrompt?: string;
}

export const makeDriverPmAdapter = (
  options: DriverPmAdapterOptions,
): Effect.Effect<PiAgentAdapterShape, never, ProviderSessionDirectory> =>
  Effect.gen(function* () {
    const directory = yield* ProviderSessionDirectory;
    const eventQueue = yield* Queue.unbounded<AgentHarnessEvent>();
    const idle = yield* Ref.make(true);
    const latestUsage = yield* Ref.make<Usage | undefined>(undefined);
    const currentModelSelection = yield* Ref.make(options.modelSelection);
    const resources = yield* Ref.make<AgentHarnessResources>({});
    const activePrompt = yield* Ref.make<
      | {
          readonly turnId: TurnId;
          readonly deferred: Deferred.Deferred<AssistantMessage, PmRuntimeError>;
        }
      | undefined
    >(undefined);
    const activeAssistant = yield* Ref.make<ActiveAssistant | undefined>(undefined);
    const activeTools = new Map<string, ActiveTool>();
    const threadId = pmThreadIdForProject(options.project);

    const offer = (event: AgentHarnessEvent) => Queue.offer(eventQueue, event).pipe(Effect.asVoid);

    const persistSession = Effect.gen(function* () {
      const sessions = yield* options.claudeAdapter.listSessions();
      const session = sessions.find((candidate) => candidate.threadId === threadId);
      if (!session) {
        return;
      }
      yield* directory.upsert({
        threadId,
        provider: CLAUDE_PROVIDER,
        providerInstanceId: options.modelSelection.instanceId,
        status: session.status === "closed" ? "stopped" : "running",
        runtimeMode: "approval-required",
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Driver PM adapter failed to persist Claude resume cursor", {
          projectId: String(options.project.id),
          cause,
        }),
      ),
    );

    const ensureAssistantStarted = (turnId: TurnId | undefined) =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(activeAssistant);
        if (existing && !existing.completed) {
          return existing;
        }
        const started: ActiveAssistant = {
          turnId,
          contentIndex: 0,
          started: true,
          completed: false,
          text: "",
        };
        yield* Ref.set(activeAssistant, started);
        const selection = yield* Ref.get(currentModelSelection);
        yield* offer({
          type: "message_start",
          message: assistantMessage({
            text: "",
            model: selection.model,
            usage: yield* Ref.get(latestUsage),
          }),
        } satisfies AgentHarnessEvent);
        return started;
      });

    const completeAssistant = (input?: {
      readonly turnId?: TurnId | undefined;
      readonly stopReason?: AssistantMessage["stopReason"];
      readonly errorMessage?: string | undefined;
    }) =>
      Effect.gen(function* () {
        const active = yield* Ref.get(activeAssistant);
        if (!active) {
          return undefined;
        }
        const selection = yield* Ref.get(currentModelSelection);
        const usage = yield* Ref.get(latestUsage);
        const message = assistantMessage({
          text: active.text,
          model: selection.model,
          usage,
          ...(input?.stopReason !== undefined ? { stopReason: input.stopReason } : {}),
          ...(input?.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
        });
        if (active.completed) {
          return message;
        }
        const completed = { ...active, completed: true };
        yield* Ref.set(activeAssistant, completed);
        yield* offer({
          type: "message_end",
          message,
        } satisfies AgentHarnessEvent);
        return message;
      });

    const handleRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (event.threadId !== threadId) {
          return;
        }

        switch (event.type) {
          case "turn.started": {
            yield* Ref.set(idle, false);
            yield* offer({ type: "agent_start" } satisfies AgentHarnessEvent);
            yield* offer({ type: "turn_start" } satisfies AgentHarnessEvent);
            return;
          }

          case "content.delta": {
            if (event.payload.streamKind !== "assistant_text") {
              return;
            }
            const active = yield* ensureAssistantStarted(event.turnId);
            const next: ActiveAssistant = {
              ...active,
              text: active.text + event.payload.delta,
            };
            yield* Ref.set(activeAssistant, next);
            const selection = yield* Ref.get(currentModelSelection);
            const message = assistantMessage({
              text: next.text,
              model: selection.model,
              usage: yield* Ref.get(latestUsage),
            });
            yield* offer({
              type: "message_update",
              message,
              assistantMessageEvent: {
                type: "text_delta",
                contentIndex: active.contentIndex,
                delta: event.payload.delta,
                partial: message,
              },
            } satisfies AgentHarnessEvent);
            return;
          }

          case "item.started": {
            const data = lifecycleToolData(event.payload);
            if (!data || !event.itemId) {
              return;
            }
            const strippedToolName = orchestrationToolName(data.toolName);
            const tool: ActiveTool = {
              toolCallId: String(event.itemId),
              toolName: strippedToolName ?? data.toolName,
              input: data.input,
              includeResultDetails: strippedToolName !== undefined,
            };
            activeTools.set(String(event.itemId), tool);
            yield* offer({
              type: "tool_call",
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              input: tool.input,
            } satisfies AgentHarnessEvent);
            return;
          }

          case "item.updated": {
            const data = lifecycleToolData(event.payload);
            if (!data || !event.itemId) {
              return;
            }
            const existing = activeTools.get(String(event.itemId));
            if (!existing) {
              return;
            }
            activeTools.set(String(event.itemId), {
              ...existing,
              input: data.input,
            });
            return;
          }

          case "item.completed": {
            if (event.payload.itemType === "assistant_message") {
              yield* completeAssistant({ turnId: event.turnId });
              return;
            }
            const data = lifecycleToolData(event.payload);
            if (!data || !event.itemId) {
              return;
            }
            const existing = activeTools.get(String(event.itemId));
            if (!existing) {
              return;
            }
            activeTools.delete(String(event.itemId));
            const isError = event.payload.status === "failed";
            yield* offer({
              type: "tool_result",
              toolCallId: existing.toolCallId,
              toolName: existing.toolName,
              input: existing.input,
              content: existing.includeResultDetails
                ? [textContent(resultText(data.result, event.payload.detail ?? ""))]
                : [],
              details: existing.includeResultDetails
                ? (data.result ?? event.payload.data)
                : undefined,
              isError,
            } satisfies AgentHarnessEvent);
            return;
          }

          case "thread.token-usage.updated": {
            yield* Ref.set(latestUsage, usageFromSnapshot(event.payload.usage));
            return;
          }

          case "turn.completed": {
            const failed = event.payload.state === "failed";
            const interrupted = event.payload.state === "interrupted";
            const completedMessage =
              (yield* completeAssistant({
                turnId: event.turnId,
                stopReason: failed ? "error" : interrupted ? "aborted" : "stop",
                errorMessage: event.payload.errorMessage,
              })) ??
              assistantMessage({
                text: "",
                model: (yield* Ref.get(currentModelSelection)).model,
                usage: yield* Ref.get(latestUsage),
                stopReason: failed ? "error" : interrupted ? "aborted" : "stop",
                errorMessage: event.payload.errorMessage,
              });
            yield* offer({
              type: "turn_end",
              message: completedMessage,
              toolResults: [],
            } satisfies AgentHarnessEvent);
            yield* offer({
              type: "agent_end",
              messages: [completedMessage],
            } satisfies AgentHarnessEvent);
            yield* offer({
              type: "settled",
              nextTurnCount: 0,
            } satisfies AgentHarnessEvent);
            yield* Ref.set(idle, true);
            yield* persistSession;
            const promptState = yield* Ref.get(activePrompt);
            if (promptState && promptState.turnId === event.turnId) {
              yield* Ref.set(activePrompt, undefined);
              if (failed) {
                yield* Deferred.fail(
                  promptState.deferred,
                  new PmRuntimeError({
                    operation: "DriverPmAdapter.prompt",
                    detail: event.payload.errorMessage ?? "Claude PM turn failed.",
                  }),
                );
              } else {
                yield* Deferred.succeed(promptState.deferred, completedMessage);
              }
            }
            return;
          }

          case "turn.aborted": {
            yield* Ref.set(idle, true);
            yield* offer({
              type: "settled",
              nextTurnCount: 0,
            } satisfies AgentHarnessEvent);
            const promptState = yield* Ref.get(activePrompt);
            if (promptState && promptState.turnId === event.turnId) {
              yield* Ref.set(activePrompt, undefined);
              yield* Deferred.fail(
                promptState.deferred,
                new PmRuntimeError({
                  operation: "DriverPmAdapter.prompt",
                  detail: event.payload.reason,
                }),
              );
            }
            return;
          }

          default:
            return;
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Driver PM adapter failed to bridge Claude event", {
            projectId: String(options.project.id),
            eventType: event.type,
            cause,
          }),
        ),
      );

    const runtimeContext = yield* Effect.context<never>();
    const bridgeFiber = Effect.runForkWith(runtimeContext)(
      options.claudeAdapter.streamEvents.pipe(Stream.runForEach(handleRuntimeEvent)),
    );

    const startSession = Effect.gen(function* () {
      const existing = yield* directory
        .getBinding(threadId)
        .pipe(Effect.map(Option.getOrUndefined));
      const persistedResumeCursor =
        existing?.provider === CLAUDE_PROVIDER &&
        existing.providerInstanceId === options.modelSelection.instanceId
          ? existing.resumeCursor
          : undefined;
      const selection = yield* Ref.get(currentModelSelection);
      const session = yield* options.claudeAdapter.startSession({
        threadId,
        provider: CLAUDE_PROVIDER,
        providerInstanceId: selection.instanceId,
        cwd: options.project.workspaceRoot,
        modelSelection: selection,
        runtimeMode: "approval-required",
        readOnly: true,
        enableOrchestrationTools: true,
        ...(options.systemPrompt !== undefined && options.systemPrompt.length > 0
          ? { systemPromptAppend: options.systemPrompt }
          : {}),
        ...(persistedResumeCursor !== null && persistedResumeCursor !== undefined
          ? { resumeCursor: persistedResumeCursor }
          : {}),
      });
      yield* directory.upsert({
        threadId,
        provider: CLAUDE_PROVIDER,
        providerInstanceId: selection.instanceId,
        status: "running",
        runtimeMode: "approval-required",
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
      });
      return session;
    }).pipe(
      Effect.mapError(
        toPmRuntimeError("DriverPmAdapter.startSession", "Failed to start Claude PM session."),
      ),
    );

    const ensureSession = Effect.gen(function* () {
      const hasSession = yield* options.claudeAdapter
        .hasSession(threadId)
        .pipe(
          Effect.mapError(
            toPmRuntimeError("DriverPmAdapter.hasSession", "Failed to inspect Claude PM session."),
          ),
        );
      if (!hasSession) {
        yield* startSession;
      }
    });

    const runTurn = (
      text: string,
      promptOptions?: { readonly images?: ReadonlyArray<ImageContent> },
    ) =>
      Effect.gen(function* () {
        if (promptOptions?.images !== undefined && promptOptions.images.length > 0) {
          return yield* new PmRuntimeError({
            operation: "DriverPmAdapter.prompt",
            detail: "Claude driver PM adapter does not support image prompts.",
          });
        }
        if (!(yield* Ref.get(idle))) {
          return yield* new PmRuntimeError({
            operation: "DriverPmAdapter.prompt",
            detail: "Claude driver PM adapter is already running a turn.",
          });
        }
        yield* ensureSession;
        yield* Ref.set(idle, false);
        yield* Ref.set(activeAssistant, undefined);
        yield* offer({
          type: "before_agent_start",
          prompt: text,
          systemPrompt: options.systemPrompt ?? "",
          resources: yield* Ref.get(resources),
        } satisfies AgentHarnessEvent);
        const deferred = yield* Deferred.make<AssistantMessage, PmRuntimeError>();
        const selection = yield* Ref.get(currentModelSelection);
        const turn = yield* options.claudeAdapter
          .sendTurn({
            threadId,
            input: text,
            modelSelection: selection,
            interactionMode: "default",
          })
          .pipe(
            Effect.mapError(
              toPmRuntimeError("DriverPmAdapter.prompt", "Failed to send Claude PM turn."),
            ),
          );
        yield* Ref.set(activePrompt, { turnId: turn.turnId, deferred });
        return yield* Deferred.await(deferred).pipe(Effect.ensuring(Ref.set(idle, true)));
      });

    return {
      events: Stream.fromQueue(eventQueue),
      isIdle: Ref.get(idle),
      latestAssistantUsage: Ref.get(latestUsage),
      waitForIdle: Effect.gen(function* () {
        const promptState = yield* Ref.get(activePrompt);
        if (promptState !== undefined) {
          yield* Deferred.await(promptState.deferred).pipe(Effect.asVoid);
        }
      }),
      prompt: runTurn,
      followUp: (text, promptOptions) =>
        Effect.gen(function* () {
          if (promptOptions?.images !== undefined && promptOptions.images.length > 0) {
            return yield* new PmRuntimeError({
              operation: "DriverPmAdapter.followUp",
              detail: "Claude driver PM adapter does not support image follow-up prompts.",
            });
          }
          yield* ensureSession;
          const selection = yield* Ref.get(currentModelSelection);
          yield* options.claudeAdapter
            .sendTurn({
              threadId,
              input: text,
              modelSelection: selection,
              interactionMode: "default",
            })
            .pipe(
              Effect.mapError(
                toPmRuntimeError(
                  "DriverPmAdapter.followUp",
                  "Failed to enqueue Claude PM follow-up.",
                ),
              ),
            );
        }),
      compact: (_customInstructions?: string) =>
        Effect.gen(function* () {
          const usage = yield* Ref.get(latestUsage);
          return {
            summary:
              "Claude driver PM adapter does not maintain a pi session tree; compaction is a no-op.",
            firstKeptEntryId: `driver-pm:${options.project.id}:latest`,
            tokensBefore: usage?.totalTokens ?? 0,
          } satisfies CompactResult;
        }),
      setModel: (model: Model<any>) =>
        Ref.update(currentModelSelection, (selection) => ({
          ...selection,
          model: model.id,
        })).pipe(
          Effect.mapError(
            toPmRuntimeError("DriverPmAdapter.setModel", "Failed to update Claude PM model."),
          ),
        ),
      setResources: (nextResources: AgentHarnessResources) =>
        Ref.set(resources, nextResources).pipe(
          Effect.mapError(
            toPmRuntimeError(
              "DriverPmAdapter.setResources",
              "Failed to update Claude PM resources.",
            ),
          ),
        ),
      abort: Effect.gen(function* () {
        const promptState = yield* Ref.get(activePrompt);
        yield* options.claudeAdapter
          .interruptTurn(threadId, promptState?.turnId)
          .pipe(Effect.catch(() => Effect.void));
        yield* options.claudeAdapter.stopSession(threadId).pipe(Effect.catch(() => Effect.void));
        yield* Fiber.interrupt(bridgeFiber);
        yield* Ref.set(idle, true);
      }).pipe(
        Effect.mapError(
          toPmRuntimeError("DriverPmAdapter.abort", "Failed to abort Claude PM adapter."),
        ),
      ),
    } satisfies PiAgentAdapterShape;
  });
