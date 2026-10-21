import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type Project as ProjectRecord,
} from "@t3tools/contracts";
import {
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
} from "@t3tools/shared/t3McpToolPresentation";
import { mcpToolPresentation } from "@t3tools/provider-core/server/mcpToolPresentation";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { McpSchema, McpServer, Tool } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import { MemoryToolkit } from "./tools.ts";

/**
 * The handler tests drive the toolkit directly. These drive the registration in
 * `McpHttpServer.layer`, so they cover what only the server does: publishing the
 * tool names, decoding JSON arguments, and encoding the result a provider sees.
 */

const threadId = ThreadId.make("registration-thread");
const projectId = ProjectId.make("registration-project");
const providerInstanceId = ProviderInstanceId.make("codex");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("registration-environment"),
  requestNamespace: "registration-session",
  thread: { threadId, providerSessionId: "registration-session", providerInstanceId },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration" as const]),
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "ged-registration", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "ged-registration", version: "1" },
  },
  getClient: Effect.die("unused"),
});

/** A workspace with one memory document, created per test and torn down with the scope. */
const withMemory = <A, E, R>(
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(path.join(root, ".ged", "plans"), { recursive: true });
    yield* fs.writeFileString(
      path.join(root, ".ged", "plans", "INDEX.md"),
      "# Verifier\nRule on each criterion.\n",
    );
    return yield* use(root);
  }).pipe(Effect.scoped);

const serverLayer = (root: string) => {
  const caller = {
    id: threadId,
    projectId,
    providerInstanceId,
    activeRunId: "registration-run",
    archivedAt: null,
    deletedAt: null,
    worktreePath: root,
  } as OrchestrationV2ThreadShell;
  return McpHttpServer.memoryToolkitRegistration.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(
      Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
        capabilities: () => Effect.succeed({ providers: [] } as never),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(caller),
        getProjectThreadRecords: () => Effect.succeed({ thread: caller, runs: [] } as never),
      }),
    ),
    Layer.provide(
      Layer.mock(Project.ProjectService)({
        getById: () =>
          Effect.succeed(Option.some({ id: projectId, workspaceRoot: root } as ProjectRecord)),
      }),
    ),
    Layer.provide(ServerConfig.layerTest(root, { prefix: "ged-registration" })),
    Layer.provide(NodeServices.layer),
  );
};

const callTool = (name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  });

it("publishes every Ged tool with a reference-free object-root input schema", () => {
  const names = Object.values(MemoryToolkit.tools).map((tool) => tool.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names.toSorted()).toEqual([
    "ged_init",
    "ged_land_check",
    "ged_memory_list",
    "ged_memory_read",
    "ged_playbook",
    "ged_review_gate_update",
    "ged_review_policy_set",
    "ged_verdict_write",
  ]);
  for (const tool of Object.values(MemoryToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool);
    expect(schema, tool.name).toMatchObject({ type: "object" });
    // Providers without $ref support have to be able to read the catalog.
    expect(JSON.stringify(schema), tool.name).not.toContain('"$ref"');
  }
});

it.effect("serves a memory document through the registered server", () =>
  withMemory((root) =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      expect(server.tools.map(({ tool }) => tool.name)).toContain("ged_memory_read");

      const result = yield* callTool("ged_memory_read", { key: "plans/INDEX.md" });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ key: "plans/INDEX.md" });
      expect(JSON.stringify(result.structuredContent)).toContain("Rule on each criterion.");
    }).pipe(Effect.provide(serverLayer(root))),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("returns a path refusal as a tool error the model can read", () =>
  withMemory((root) =>
    Effect.gen(function* () {
      // The tools declare failureMode "return", so a refusal is the result.
      const result = yield* callTool("ged_memory_read", { key: "../../etc/hosts" });
      expect(result.isError).toBe(true);
      const text = result.content[0];
      expect(text?.type === "text" && text.text).toContain("segments");
    }).pipe(Effect.provide(serverLayer(root))),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it("renders in a client without T3's tool catalog, because it is not in it", () => {
  // Known limit, recorded in DECISIONS.md: adding the Ged tools to
  // packages/shared/src/t3McpToolPresentation.ts would modify a hot upstream
  // file for branding alone. The fallback has to stay usable instead.
  for (const tool of Object.values(MemoryToolkit.tools)) {
    expect(resolveT3McpToolDefinition(tool.name), tool.name).toBeNull();
    expect(resolveT3McpToolPresentation(`mcp__t3-code__${tool.name}`), tool.name).toBeNull();
    expect(mcpToolPresentation({ toolName: `mcp__t3-code__${tool.name}` }).title, tool.name).toBe(
      tool.name.replaceAll("_", " "),
    );
  }
});

it.effect(
  "validates explicit policy scope, mode, visible reason and full SHA at the MCP boundary",
  () =>
    withMemory((root) =>
      Effect.gen(function* () {
        for (const args of [
          { mode: "skip", reason: "User request" },
          { scope: "project", reason: "User request" },
          { scope: "project", mode: "skip", reason: " " },
          { scope: "project", mode: "skip", reason: "\u200b\u202e" },
          { scope: "project", mode: "skip", reason: "\u0000" },
          { scope: "change", mode: "skip", reason: "User request", headSha: "next" },
          { scope: "all", mode: "skip", reason: "User request" },
        ]) {
          const error = yield* Effect.flip(callTool("ged_review_policy_set", args));
          expect(error._tag).toBe("InvalidParams");
        }
        const listed = yield* callTool("ged_memory_list", {});
        expect(listed.isError).not.toBe(true);
        expect(listed.structuredContent).toMatchObject({
          reviewPolicy: { required: true, valid: false },
        });
      }).pipe(Effect.provide(serverLayer(root))),
    ).pipe(Effect.provide(NodeServices.layer)),
);
