// @effect-diagnostics nodeBuiltinImport:off
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { PmToolExecutor } from "../pm/pmTools.ts";
import {
  ORCHESTRATION_MCP_INSTRUCTIONS,
  ORCHESTRATION_MCP_SERVER_NAME,
  mcpInputSchemas,
  orderOrchestrationMcpExecutors,
  makeOrchestrationMcpExecutors,
  type OrchestrationMcpToolName,
} from "./orchestrationMcpTools.ts";

export const ORCHESTRATION_MCP_HTTP_PATH = "/mcp/orchestration";
export const ORCHESTRATION_MCP_BEARER_TOKEN_ENV_VAR = "T3_ORCHESTRATION_MCP_BEARER_TOKEN";

export interface OrchestrationMcpEndpoint {
  readonly url: string;
  readonly bearerToken: string;
  readonly bearerTokenEnvVar: typeof ORCHESTRATION_MCP_BEARER_TOKEN_ENV_VAR;
}

export interface OrchestrationMcpHttpServerShape {
  readonly endpoint: OrchestrationMcpEndpoint;
}

export class OrchestrationMcpHttpServer extends Context.Service<
  OrchestrationMcpHttpServer,
  OrchestrationMcpHttpServerShape
>()("gedcode/orchestration/mcp/OrchestrationMcpHttpServer") {}

export const makeCodexMcpServerConfig = (
  endpoint: OrchestrationMcpEndpoint,
): Record<string, unknown> => ({
  mcp_servers: {
    [ORCHESTRATION_MCP_SERVER_NAME]: {
      url: endpoint.url,
      bearer_token_env_var: endpoint.bearerTokenEnvVar,
      // This server is created by GedCode on loopback for the current process and protected by a
      // random bearer token. PM sessions have no approval UI, so leaving the Codex MCP default at
      // `prompt` turns every lifecycle request into an immediate synthetic rejection.
      default_tools_approval_mode: "approve",
    },
  },
});

export const makeCodexMcpEnvironment = (endpoint: OrchestrationMcpEndpoint): NodeJS.ProcessEnv => ({
  [endpoint.bearerTokenEnvVar]: endpoint.bearerToken,
});

export function makeOrchestrationMcpServerFromExecutors(
  executors: ReadonlyArray<PmToolExecutor<any, unknown>>,
): McpServer {
  const server = new McpServer(
    {
      name: ORCHESTRATION_MCP_SERVER_NAME,
      version: "1.0.0",
    },
    {
      instructions: ORCHESTRATION_MCP_INSTRUCTIONS,
    },
  );
  const orderedExecutors = orderOrchestrationMcpExecutors(executors);

  for (const executor of orderedExecutors) {
    const name = executor.name as OrchestrationMcpToolName;
    server.registerTool(
      name,
      {
        title: executor.label,
        description: executor.description,
        inputSchema: mcpInputSchemas[name],
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const result = await executor.execute(`mcp:${name}:${randomUUID()}`, args);
        const structuredContent =
          typeof result.details === "object" && result.details !== null
            ? (result.details as Record<string, unknown>)
            : { value: result.details };
        return {
          content: [...result.content],
          structuredContent,
        };
      },
    );
  }

  return server;
}

export async function startOrchestrationMcpHttpServer(input: {
  readonly executors: ReadonlyArray<PmToolExecutor<any, unknown>>;
  readonly bearerToken?: string;
}): Promise<OrchestrationMcpHttpServerShape & { readonly close: () => Promise<void> }> {
  const bearerToken = input.bearerToken ?? randomBytes(32).toString("base64url");
  const httpServer = createServer((request, response) => {
    void handleMcpRequest({
      request,
      response,
      executors: input.executors,
      bearerToken,
    });
  });
  const port = await listenLoopback(httpServer);
  const endpoint = {
    url: `http://127.0.0.1:${port}${ORCHESTRATION_MCP_HTTP_PATH}`,
    bearerToken,
    bearerTokenEnvVar: ORCHESTRATION_MCP_BEARER_TOKEN_ENV_VAR,
  } satisfies OrchestrationMcpEndpoint;
  return {
    endpoint,
    close: () => closeServer(httpServer),
  };
}

export const makeOrchestrationMcpHttpServer = (input?: {
  readonly executors?: ReadonlyArray<PmToolExecutor<any, unknown>>;
  readonly bearerToken?: string;
}) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const executors = input?.executors ?? (yield* makeOrchestrationMcpExecutors);
      return yield* Effect.promise(() =>
        startOrchestrationMcpHttpServer({
          executors,
          ...(input?.bearerToken ? { bearerToken: input.bearerToken } : {}),
        }),
      );
    }),
    (server) => Effect.promise(() => server.close()),
  ).pipe(Effect.map((server) => OrchestrationMcpHttpServer.of({ endpoint: server.endpoint })));

export const OrchestrationMcpHttpServerLive = Layer.effect(
  OrchestrationMcpHttpServer,
  makeOrchestrationMcpHttpServer(),
);

function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Orchestration MCP HTTP server did not expose a TCP port."));
        return;
      }
      resolve((address as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function handleMcpRequest(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly executors: ReadonlyArray<PmToolExecutor<any, unknown>>;
  readonly bearerToken: string;
}): Promise<void> {
  const url = new URL(input.request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== ORCHESTRATION_MCP_HTTP_PATH) {
    input.response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    input.response.end("Not Found");
    return;
  }

  if (input.request.headers.authorization !== `Bearer ${input.bearerToken}`) {
    input.response.writeHead(401, {
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": 'Bearer realm="t3-orchestration-mcp"',
    });
    input.response.end("Unauthorized");
    return;
  }

  const mcpServer = makeOrchestrationMcpServerFromExecutors(input.executors);
  const transport = new StreamableHTTPServerTransport();
  input.response.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });

  try {
    await mcpServer.connect(transport as unknown as Parameters<McpServer["connect"]>[0]);
    await transport.handleRequest(input.request, input.response);
  } catch (cause) {
    if (!input.response.headersSent) {
      input.response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      input.response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: cause instanceof Error ? cause.message : "Internal server error",
          },
          id: null,
        }),
      );
    }
  }
}
