import {
  AgentHarness,
  Session,
  type AgentHarnessEvent,
  type AgentHarnessOptions,
  type AgentHarnessResources,
  type AgentTool,
  type CompactResult,
  type ExecutionEnv,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Model, Usage } from "@earendil-works/pi-ai";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { PmRuntimeError, toPmRuntimeError } from "./Errors.ts";

type HarnessLike = {
  readonly prompt: (
    text: string,
    options?: { readonly images?: ImageContent[] },
  ) => Promise<AssistantMessage>;
  readonly followUp: (
    text: string,
    options?: { readonly images?: ImageContent[] },
  ) => Promise<void>;
  readonly compact: (customInstructions?: string) => Promise<CompactResult>;
  readonly abort: () => Promise<unknown>;
  readonly waitForIdle: () => Promise<void>;
  readonly setModel: (model: Model<any>) => Promise<void>;
  readonly setResources: (resources: AgentHarnessResources<Skill, PromptTemplate>) => Promise<void>;
  readonly subscribe: (listener: (event: AgentHarnessEvent) => void | Promise<void>) => () => void;
};

type HarnessFactory = (options: AgentHarnessOptions) => HarnessLike;

export type PiAgentAdapterOptions = {
  readonly env: ExecutionEnv;
  readonly sessionStorage: ConstructorParameters<typeof Session>[0];
  readonly model: Model<any>;
  readonly tools?: ReadonlyArray<AgentTool>;
  readonly resources?: AgentHarnessResources<Skill, PromptTemplate>;
  readonly systemPrompt?: AgentHarnessOptions["systemPrompt"];
  readonly getApiKeyAndHeaders?: AgentHarnessOptions["getApiKeyAndHeaders"];
  readonly harnessFactory?: HarnessFactory;
};

export type PiAgentAdapterShape = {
  readonly events: Stream.Stream<AgentHarnessEvent>;
  readonly isIdle: Effect.Effect<boolean>;
  readonly latestAssistantUsage: Effect.Effect<Usage | undefined>;
  readonly waitForIdle: Effect.Effect<void, PmRuntimeError>;
  readonly prompt: (
    text: string,
    options?: { readonly images?: ReadonlyArray<ImageContent> },
  ) => Effect.Effect<AssistantMessage, PmRuntimeError>;
  readonly followUp: (
    text: string,
    options?: { readonly images?: ReadonlyArray<ImageContent> },
  ) => Effect.Effect<void, PmRuntimeError>;
  readonly compact: (customInstructions?: string) => Effect.Effect<CompactResult, PmRuntimeError>;
  readonly setModel: (model: Model<any>) => Effect.Effect<void, PmRuntimeError>;
  readonly setResources: (
    resources: AgentHarnessResources<Skill, PromptTemplate>,
  ) => Effect.Effect<void, PmRuntimeError>;
  readonly abort: Effect.Effect<void, PmRuntimeError>;
};

const defaultHarnessFactory: HarnessFactory = (options) => new AgentHarness(options);

const readonlyImages = (options?: {
  readonly images?: ReadonlyArray<ImageContent>;
}): { images?: ImageContent[] } | undefined =>
  options?.images === undefined ? undefined : { images: [...options.images] };

const eventAssistantUsage = (event: AgentHarnessEvent): Usage | undefined => {
  if (
    (event.type === "message_end" || event.type === "turn_end") &&
    event.message.role === "assistant" &&
    event.message.stopReason !== "aborted" &&
    event.message.stopReason !== "error"
  ) {
    return event.message.usage;
  }

  return undefined;
};

export const makePiAgentAdapter = (
  options: PiAgentAdapterOptions,
): Effect.Effect<PiAgentAdapterShape, never, never> =>
  Effect.gen(function* () {
    const idle = yield* Ref.make(true);
    const latestAssistantUsage = yield* Ref.make<Usage | undefined>(undefined);
    const eventQueue = yield* Queue.unbounded<AgentHarnessEvent>();
    const runtimeContext = yield* Effect.context<never>();
    const runSync = Effect.runSyncWith(runtimeContext);
    const session = new Session(options.sessionStorage);

    const harnessOptions = {
      env: options.env,
      session,
      model: options.model,
      ...(options.tools !== undefined ? { tools: [...options.tools] } : {}),
      ...(options.resources !== undefined ? { resources: options.resources } : {}),
      ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.getApiKeyAndHeaders !== undefined
        ? { getApiKeyAndHeaders: options.getApiKeyAndHeaders }
        : {}),
    } satisfies AgentHarnessOptions;
    const harness = (options.harnessFactory ?? defaultHarnessFactory)(harnessOptions);

    const unsubscribe = harness.subscribe((event) => {
      if (
        event.type === "agent_start" ||
        event.type === "turn_start" ||
        event.type === "before_agent_start"
      ) {
        runSync(Ref.set(idle, false));
      } else if (event.type === "agent_end" || event.type === "settled") {
        runSync(Ref.set(idle, true));
      }
      const usage = eventAssistantUsage(event);
      if (usage !== undefined) {
        runSync(Ref.set(latestAssistantUsage, usage));
      }
      runSync(Queue.offer(eventQueue, event));
    });

    return {
      events: Stream.fromQueue(eventQueue),
      isIdle: Ref.get(idle),
      latestAssistantUsage: Ref.get(latestAssistantUsage),
      waitForIdle: Effect.tryPromise({
        try: () => harness.waitForIdle(),
        catch: toPmRuntimeError("PiAgentAdapter.waitForIdle", "Failed while waiting for PM idle."),
      }),
      prompt: (text, promptOptions) =>
        Effect.gen(function* () {
          yield* Ref.set(idle, false);
          return yield* Effect.tryPromise({
            try: () => harness.prompt(text, readonlyImages(promptOptions)),
            catch: toPmRuntimeError("PiAgentAdapter.prompt", "PM prompt failed."),
          }).pipe(Effect.ensuring(Ref.set(idle, true)));
        }),
      followUp: (text, promptOptions) =>
        Effect.tryPromise({
          try: () => harness.followUp(text, readonlyImages(promptOptions)),
          catch: toPmRuntimeError("PiAgentAdapter.followUp", "PM follow-up failed."),
        }),
      compact: (customInstructions) =>
        Effect.tryPromise({
          try: () => harness.compact(customInstructions),
          catch: toPmRuntimeError("PiAgentAdapter.compact", "PM compaction failed."),
        }),
      setModel: (model) =>
        Effect.tryPromise({
          try: () => harness.setModel(model),
          catch: toPmRuntimeError("PiAgentAdapter.setModel", "PM model update failed."),
        }),
      setResources: (resources) =>
        Effect.tryPromise({
          try: () => harness.setResources(resources),
          catch: toPmRuntimeError("PiAgentAdapter.setResources", "PM resource update failed."),
        }),
      abort: Effect.asVoid(
        Effect.tryPromise({
          try: async () => {
            unsubscribe();
            await harness.abort();
          },
          catch: toPmRuntimeError("PiAgentAdapter.abort", "PM abort failed."),
        }),
      ),
    } satisfies PiAgentAdapterShape;
  });
