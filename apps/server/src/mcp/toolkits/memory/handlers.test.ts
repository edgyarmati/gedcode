import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type Project as ProjectRecord,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- the fixture builds a real checkout synchronously, before any Effect runtime exists to run a Command in.
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ProjectMemory from "../../../ged/ProjectMemory.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as MemoryHandlers from "./handlers.ts";
import { MemoryToolkit } from "./tools.ts";

const threadId = ThreadId.make("lead-thread");
const projectId = ProjectId.make("project");
const providerInstanceId = ProviderInstanceId.make("codex");

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();

/**
 * A real checkout with the project's own land gate, so the tools are exercised
 * against the script that actually guards a push rather than a stand-in.
 */
const withCheckout = <A, E, R>(
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const ged = path.join(root, ".ged");
    yield* fs.makeDirectory(path.join(ged, "roles"), { recursive: true });
    yield* fs.makeDirectory(path.join(ged, "bin"), { recursive: true });
    yield* fs.makeDirectory(path.join(ged, "verdicts"), { recursive: true });
    yield* fs.writeFileString(
      path.join(ged, "roles", "verifier.md"),
      "# Verifier\nRule on each.\n",
    );
    yield* fs.writeFileString(path.join(ged, "roles", "planner.md"), "# Planner\n");
    yield* fs.writeFileString(path.join(ged, "roles", "implementer.md"), "# Implementer\n");
    yield* fs.writeFileString(path.join(ged, "roles", "model-policy.md"), "# Model policy\n");
    yield* fs.writeFileString(path.join(ged, "verdicts", ".gitignore"), "*.json\n");
    yield* fs.copyFile(
      path.resolve(import.meta.dirname, "../../../../../../.ged/bin/land-gate.sh"),
      path.join(ged, "bin", "land-gate.sh"),
    );
    yield* fs.chmod(path.join(ged, "bin", "land-gate.sh"), 0o755);
    yield* Effect.sync(() => {
      git(root, "init", "--initial-branch", "feat/memory");
      git(root, "config", "user.email", "test@example.com");
      git(root, "config", "user.name", "Test");
      git(root, "add", "-A");
      git(root, "commit", "-m", "fixture");
    });
    return yield* use(root);
  }).pipe(Effect.scoped);

const dependencies = (root: string) => {
  const caller = {
    id: threadId,
    projectId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    activeRunId: "active-run",
    archivedAt: null,
    deletedAt: null,
    worktreePath: root,
  } as OrchestrationV2ThreadShell;
  return Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment"),
      requestNamespace: "session",
      thread: { threadId, providerSessionId: "session", providerInstanceId },
      client: undefined,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed(caller),
      getProjectThreadRecords: () => Effect.succeed({ thread: caller, runs: [] } as never),
    }),
    Layer.mock(Project.ProjectService)({
      getById: () =>
        Effect.succeed(Option.some({ id: projectId, workspaceRoot: root } as ProjectRecord)),
    }),
    ProjectMemory.layer,
    // NodeServices has to come under the merge, not inside it: ProjectMemory
    // needs its FileSystem, Path, and process spawner, and Layer.mergeAll
    // builds its members in parallel without satisfying each other.
  ).pipe(Layer.provideMerge(NodeServices.layer));
};

/** Drives a tool the way the MCP server does, through the toolkit's own dispatch. */
const call = <Name extends keyof typeof MemoryToolkit.tools>(
  root: string,
  name: Name,
  params: unknown,
) =>
  Effect.gen(function* () {
    const layer = dependencies(root);
    const toolkit = yield* MemoryToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(MemoryHandlers.layer).pipe(Layer.provide(layer)),
      ),
    );
    const parts = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(layer));
    return parts.at(-1)?.result as never;
  });

it.effect("serves the memory listing and a document to the calling thread", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const listed = (yield* call(root, "ged_memory_list", {})) as {
        documents: ReadonlyArray<{ key: string }>;
      };
      expect(listed.documents.map((document) => document.key)).toContain("roles/verifier.md");
      const read = (yield* call(root, "ged_memory_read", { key: "roles/verifier.md" })) as {
        content: string;
      };
      expect(read.content).toContain("Rule on each.");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("hands a role its brief and the model policy in one call", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const brief = (yield* call(root, "ged_role_brief", { role: "verifier" })) as {
        brief: string;
        modelPolicy: string | null;
      };
      expect(brief.brief).toContain("# Verifier");
      expect(brief.modelPolicy).toContain("# Model policy");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses to serve a document outside the memory tree", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      // The tools declare failureMode "return", so a refusal comes back as the
      // tool's result — which is what the model sees.
      const refusal = yield* call(root, "ged_memory_read", { key: "../../etc/hosts" });
      expect(String(refusal)).toContain("segments");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("blocks the branch until a verdict is written, then allows it", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const blocked = (yield* call(root, "ged_land_check", {})) as { allowed: boolean };
      expect(blocked.allowed).toBe(false);

      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      const written = (yield* call(root, "ged_verdict_write", {
        branch: "feat/memory",
        headSha,
        status: "pass",
        criteria: [
          {
            criterion: "The toolkit is registered",
            verdict: "met",
            evidence: "McpHttpServer.ts:869 includes the memory registration layer",
          },
        ],
        implementer: { driverKind: "codex" },
        verifier: { driverKind: "claudeAgent" },
      })) as { path: string; ruling: string };
      expect(written.path).toBe(".ged/verdicts/feat-memory.json");
      expect(written.ruling).toMatch(/^allowed/);

      const allowed = (yield* call(root, "ged_land_check", {})) as { allowed: boolean };
      expect(allowed.allowed).toBe(true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses a verdict whose verifier shares the implementer's vendor", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      const refusal = yield* call(root, "ged_verdict_write", {
        branch: "feat/memory",
        headSha,
        status: "pass",
        criteria: [{ criterion: "It works", verdict: "met", evidence: "the tests pass" }],
        implementer: { driverKind: "codex" },
        // Padding and case must not buy independence the record does not have.
        verifier: { driverKind: " Codex " },
      });
      expect(String(refusal)).toContain("same vendor");
      const stillBlocked = (yield* call(root, "ged_land_check", {})) as { allowed: boolean };
      expect(stillBlocked.allowed).toBe(false);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
