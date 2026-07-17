import type {
  ProviderRuntimeApprovalRequestedEvent,
  ProviderRuntimeApprovalResolvedEvent,
  ProviderRuntimeUserInputRequestedEvent,
  ProviderRuntimeUserInputResolvedEvent,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { PmRuntimeError } from "../pm/Errors.ts";

export interface TextContent {
  readonly type: "text";
  readonly text: string;
  readonly textSignature?: string;
}

export interface ThinkingContent {
  readonly type: "thinking";
  readonly thinking: string;
  readonly thinkingSignature?: string;
  readonly redacted?: boolean;
}

export interface ImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export interface ToolCall {
  readonly type: "toolCall";
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly thoughtSignature?: string;
}

export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: ReadonlyArray<TextContent | ThinkingContent | ToolCall>;
  readonly api: string;
  readonly provider: string;
  readonly model: string;
  readonly responseModel?: string;
  readonly responseId?: string;
  readonly diagnostics?: ReadonlyArray<unknown>;
  readonly usage: Usage;
  readonly stopReason: StopReason;
  readonly errorMessage?: string;
  readonly timestamp: number;
}

export interface ToolResultMessage<TDetails = unknown> {
  readonly role: "toolResult";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: ReadonlyArray<TextContent | ImageContent>;
  readonly details?: TDetails;
  readonly isError: boolean;
  readonly timestamp: number;
}

export interface UserMessage {
  readonly role: "user";
  readonly content: string | ReadonlyArray<TextContent | ImageContent>;
  readonly timestamp: number;
}

export type AgentMessage = AssistantMessage | ToolResultMessage | UserMessage;

export type AssistantMessageEvent =
  | {
      readonly type: "start";
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "text_start";
      readonly contentIndex: number;
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "text_delta";
      readonly contentIndex: number;
      readonly delta: string;
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "text_end";
      readonly contentIndex: number;
      readonly content: string;
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "thinking_start" | "thinking_delta";
      readonly contentIndex: number;
      readonly delta?: string;
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "thinking_end";
      readonly contentIndex: number;
      readonly content: string;
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "toolcall_start" | "toolcall_delta";
      readonly contentIndex: number;
      readonly delta?: string;
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "toolcall_end";
      readonly contentIndex: number;
      readonly toolCall: ToolCall;
      readonly partial: AssistantMessage;
    }
  | {
      readonly type: "done";
      readonly reason: Extract<StopReason, "stop" | "length" | "toolUse">;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "error";
      readonly reason: Extract<StopReason, "aborted" | "error">;
      readonly error: AssistantMessage;
    };

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly filePath: string;
  readonly disableModelInvocation?: boolean;
}

export interface PromptTemplate {
  readonly name: string;
  readonly description?: string;
  readonly content: string;
}

export interface AgentHarnessResources<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  readonly promptTemplates?: ReadonlyArray<TPromptTemplate>;
  readonly skills?: ReadonlyArray<TSkill>;
}

export interface ModelDescriptor<TApi extends string = string> {
  readonly id: string;
  readonly name?: string;
  readonly api?: TApi;
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly reasoning?: boolean;
  readonly input?: ReadonlyArray<"text" | "image">;
  readonly cost?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly headers?: Record<string, string>;
}

export type AgentHarnessEvent =
  | {
      readonly type: "agent_start";
    }
  | {
      readonly type: "agent_end";
      readonly messages: ReadonlyArray<AgentMessage>;
    }
  | {
      readonly type: "turn_start";
    }
  | {
      readonly type: "turn_end";
      readonly message: AgentMessage;
      readonly toolResults: ReadonlyArray<ToolResultMessage>;
    }
  | {
      readonly type: "message_start";
      readonly message: AgentMessage;
    }
  | {
      readonly type: "message_update";
      readonly message: AgentMessage;
      readonly assistantMessageEvent: AssistantMessageEvent;
    }
  | {
      readonly type: "message_end";
      readonly message: AgentMessage;
    }
  | {
      readonly type: "tool_call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly type: "tool_result";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: Record<string, unknown>;
      readonly content: ReadonlyArray<TextContent | ImageContent>;
      readonly details: unknown;
      readonly isError: boolean;
    }
  | {
      readonly type: "before_agent_start";
      readonly prompt: string;
      readonly images?: ReadonlyArray<ImageContent>;
      readonly systemPrompt?: string;
      readonly resources?: AgentHarnessResources;
    }
  | {
      readonly type: "settled";
      readonly nextTurnCount: number;
    }
  | {
      readonly type: "provider_runtime_approval_requested";
      readonly event: ProviderRuntimeApprovalRequestedEvent;
    }
  | {
      readonly type: "provider_runtime_approval_resolved";
      readonly event: ProviderRuntimeApprovalResolvedEvent;
    }
  | {
      readonly type: "provider_runtime_user_input_requested";
      readonly event: ProviderRuntimeUserInputRequestedEvent;
    }
  | {
      readonly type: "provider_runtime_user_input_resolved";
      readonly event: ProviderRuntimeUserInputResolvedEvent;
    }
  | {
      readonly type: "provider_runtime_turn_abnormal_end";
      readonly createdAt: string;
      readonly reason: string;
    };

export type PmAdapterShape = {
  readonly events: Stream.Stream<AgentHarnessEvent>;
  readonly isIdle: Effect.Effect<boolean>;
  readonly latestAssistantUsage: Effect.Effect<Usage | undefined>;
  readonly start: Effect.Effect<void, PmRuntimeError>;
  readonly waitForIdle: Effect.Effect<void, PmRuntimeError>;
  readonly prompt: (
    text: string,
    options?: { readonly images?: ReadonlyArray<ImageContent> },
  ) => Effect.Effect<AssistantMessage, PmRuntimeError>;
  readonly followUp: (
    text: string,
    options?: { readonly images?: ReadonlyArray<ImageContent> },
  ) => Effect.Effect<void, PmRuntimeError>;
  readonly setModel: (model: ModelDescriptor) => Effect.Effect<void, PmRuntimeError>;
  readonly setResources: (resources: AgentHarnessResources) => Effect.Effect<void, PmRuntimeError>;
  readonly abort: Effect.Effect<void, PmRuntimeError>;
};

export const fauxAssistantMessage = (text: string): AssistantMessage => ({
  role: "assistant",
  content: text.length > 0 ? [{ type: "text", text }] : [],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "test-model",
  usage: {
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
  },
  stopReason: "stop",
  timestamp: 0,
});
