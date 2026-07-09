import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export const ORCHESTRATION_MCP_SERVER_PROVIDER_MISSING_MESSAGE =
  "Claude orchestration MCP tools require makeOrchestrationMcpServer.";

export type OrchestrationMcpServerFactory = () => Promise<McpServerConfig>;

export class OrchestrationMcpServerProviderError extends Data.TaggedError(
  "OrchestrationMcpServerProviderError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface OrchestrationMcpServerProviderShape {
  readonly register: (factory: OrchestrationMcpServerFactory) => Effect.Effect<void>;
  readonly build: Effect.Effect<McpServerConfig, OrchestrationMcpServerProviderError>;
}

export class OrchestrationMcpServerProvider extends Context.Service<
  OrchestrationMcpServerProvider,
  OrchestrationMcpServerProviderShape
>()("gedcode/orchestration/claude/OrchestrationMcpServerProvider") {}

export const makeOrchestrationMcpServerProvider = Effect.gen(function* () {
  const factoryRef = yield* Ref.make<OrchestrationMcpServerFactory | undefined>(undefined);

  return OrchestrationMcpServerProvider.of({
    register: (factory) => Ref.set(factoryRef, factory),
    build: Ref.get(factoryRef).pipe(
      Effect.flatMap((factory) => {
        if (!factory) {
          return Effect.fail(
            new OrchestrationMcpServerProviderError({
              message: ORCHESTRATION_MCP_SERVER_PROVIDER_MISSING_MESSAGE,
            }),
          );
        }
        return Effect.tryPromise({
          try: factory,
          catch: (cause) =>
            new OrchestrationMcpServerProviderError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }),
    ),
  });
});

export const OrchestrationMcpServerProviderLive = Layer.effect(
  OrchestrationMcpServerProvider,
  makeOrchestrationMcpServerProvider,
);
