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

import * as GedSetup from "../../../ged/GedSetup.ts";
import * as GedSetupOffers from "../../../ged/GedSetupOffers.ts";
import * as ProjectMemory from "../../../ged/ProjectMemory.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
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
    yield* fs.makeDirectory(path.join(ged, "plans"), { recursive: true });
    yield* fs.makeDirectory(path.join(ged, "bin"), { recursive: true });
    yield* fs.makeDirectory(path.join(ged, "verdicts"), { recursive: true });
    yield* fs.writeFileString(path.join(ged, "plans", "INDEX.md"), "# Plans\nRule on each.\n");
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

/** The driver kinds that could run a child task, as the live catalog reports them. */
type Installed = ReadonlyArray<string>;

const dependencies = (
  root: string,
  installed: Installed,
  client?: McpInvocationContext.McpClientCaller,
  offersDir = `${root}.offers`,
) => {
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
      client,
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
    Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
      capabilities: () =>
        Effect.succeed({
          providers: installed.map((driverKind) => ({ driverKind, canRunChildTask: true })),
        } as never),
    }),
    ProjectMemory.layer,
    GedSetup.layer,
    GedSetupOffers.layerAt(offersDir),
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
  installed: Installed = ["codex", "claudeAgent"],
  client?: McpInvocationContext.McpClientCaller,
  offersDir?: string,
) =>
  Effect.gen(function* () {
    const layer = dependencies(root, installed, client, offersDir);
    const toolkit = yield* MemoryToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(MemoryHandlers.layer).pipe(Layer.provide(layer)),
      ),
    );
    const parts = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(layer));
    return parts.at(-1)?.result as unknown;
  });

it.effect("serves the memory listing and a document to the calling thread", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const listed = (yield* call(root, "ged_memory_list", {})) as {
        documents: ReadonlyArray<{ key: string }>;
      };
      expect(listed.documents.map((document) => document.key)).toContain("plans/INDEX.md");
      const read = (yield* call(root, "ged_memory_read", { key: "plans/INDEX.md" })) as {
        content: string;
      };
      expect(read.content).toContain("Rule on each.");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("offers Ged setup once per project, and never where Ged is set up", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const offers = yield* fs.makeTempDirectoryScoped();
    const list = () =>
      call(root, "ged_memory_list", {}, undefined, undefined, offers).pipe(
        Effect.map((result) => result as { setUp: boolean; offerSetup: boolean }),
      );

    expect(yield* list()).toMatchObject({ setUp: false, offerSetup: true });
    // A second thread in the same project, even after a restart, is not asked again.
    expect(yield* list()).toMatchObject({ setUp: false, offerSetup: false });
    expect(yield* fs.readDirectory(root)).toEqual([]);

    yield* fs.makeDirectory(path.join(root, ".ged"));
    expect(yield* list()).toMatchObject({ setUp: true, offerSetup: false });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("serves a playbook by name, from GedCode rather than the project", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const playbook = (yield* call(root, "ged_playbook", { name: "verifier" })) as {
        name: string;
        content: string;
      };
      expect(playbook.name).toBe("verifier");
      expect(playbook.content).toContain("otherVendorAvailable");
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

const ruling = (headSha: string, verifier: { driverKind: string; model?: string }) => ({
  branch: "feat/memory",
  headSha,
  status: "pass",
  criteria: [
    {
      criterion: "The toolkit is registered",
      verdict: "met",
      evidence: "McpHttpServer.ts includes the memory registration layer",
    },
  ],
  implementer: { driverKind: "codex" },
  verifier,
});

const landCheck = (root: string) =>
  call(root, "ged_land_check", {}).pipe(
    Effect.map((result) => result as { allowed: boolean; detail: string }),
  );

it.effect("blocks the branch until a foreign verdict is written, then allows it", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      expect((yield* landCheck(root)).allowed).toBe(false);
      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      const written = (yield* call(
        root,
        "ged_verdict_write",
        ruling(headSha, { driverKind: "claudeAgent" }),
      )) as { path: string; ruling: string };
      expect(written.path).toBe(".ged/verdicts/feat-memory.json");
      expect(written.ruling).toMatch(/^allowed/);
      expect((yield* landCheck(root)).allowed).toBe(true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("blocks a same-vendor-only verdict while another vendor is installed", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      // Padding and case must not buy independence the record does not have.
      yield* call(root, "ged_verdict_write", ruling(headSha, { driverKind: " Codex " }));
      const blocked = yield* landCheck(root);
      expect(blocked.allowed).toBe(false);
      expect(blocked.detail).toContain("another vendor was installed");

      // A foreign ruling joins the same-vendor one, and together they pass.
      yield* call(root, "ged_verdict_write", ruling(headSha, { driverKind: "claudeAgent" }));
      expect((yield* landCheck(root)).allowed).toBe(true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("allows a same-vendor verdict, with a warning, when no other vendor is installed", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      const written = (yield* call(
        root,
        "ged_verdict_write",
        ruling(headSha, { driverKind: "codex", model: "gpt-6-sol" }),
        ["codex"],
      )) as { ruling: string };
      expect(written.ruling).toMatch(/^allowed/);
      expect(written.ruling).toContain("no other vendor was installed");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("blocks when any one of several verifiers fails", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      yield* call(root, "ged_verdict_write", ruling(headSha, { driverKind: "claudeAgent" }));
      yield* call(root, "ged_verdict_write", {
        ...ruling(headSha, { driverKind: "codex", model: "gpt-6-sol" }),
        status: "fail",
      });
      expect((yield* landCheck(root)).allowed).toBe(false);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("blocks records the gate cannot trust, however they were written", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      const review = {
        verifier: { driverKind: "claudeAgent" },
        status: "pass",
        criteria: [{ criterion: "It works", verdict: "met", evidence: "the tests pass" }],
        otherVendorAvailable: true,
      };
      const record = (overrides: Record<string, unknown>) => ({
        schemaVersion: 2,
        branch: "feat/memory",
        headSha,
        implementer: { driverKind: "codex" },
        reviews: [review],
        ...overrides,
      });
      const cases: ReadonlyArray<[string, unknown]> = [
        ["an older record", { ...record({}), schemaVersion: 1 }],
        ["no reviews", record({ reviews: [] })],
        [
          "invisible evidence",
          record({
            reviews: [
              {
                ...review,
                criteria: [{ criterion: "It works", verdict: "met", evidence: "‪‫‬" }],
              },
            ],
          }),
        ],
        [
          "an unknown vendor",
          record({ reviews: [{ ...review, verifier: { driverKind: "acme" } }] }),
        ],
      ];
      const file = path.join(root, ".ged", "verdicts", "feat-memory.json");
      for (const [name, contents] of cases) {
        yield* fs.writeFileString(file, JSON.stringify(contents));
        expect((yield* landCheck(root)).allowed, name).toBe(false);
      }
      yield* fs.writeFileString(file, JSON.stringify(record({})));
      expect((yield* landCheck(root)).allowed).toBe(true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("previews setup, then adds only what the project lacks", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const preview = (yield* call(root, "ged_init", {})) as {
        applied: boolean;
        missing: ReadonlyArray<string>;
        present: ReadonlyArray<string>;
      };
      expect(preview.applied).toBe(false);
      expect(preview.missing).toContain(".ged/STANDARDS.md");
      expect(preview.present).toContain(".ged/bin/land-gate.sh");
      expect(yield* fs.exists(path.join(root, ".ged", "STANDARDS.md"))).toBe(false);

      const applied = (yield* call(root, "ged_init", { apply: true })) as typeof preview;
      expect(applied.applied).toBe(true);
      expect(applied.missing).toEqual(preview.missing);
      expect(yield* fs.readFileString(path.join(root, ".ged", "STANDARDS.md"))).toContain(
        "## Checks",
      );
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses the land check to a read-only client, since it runs a repository script", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const refusal = yield* call(root, "ged_land_check", {}, undefined, {
        sessionId: "client-session",
        label: "reader",
        access: "read-only",
      });
      expect(String(refusal)).toContain("read-only");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("does not count bidirectional control characters as evidence", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const headSha = yield* Effect.sync(() => git(root, "rev-parse", "HEAD"));
      // Every character the gate strips: LRM, RLM, the embeddings and overrides, the isolates.
      const invisible = "‎‏‪‫‬‭‮⁦⁧⁨⁩";
      for (const evidence of [invisible, `${invisible}ab`]) {
        yield* fs.writeFileString(
          path.join(root, ".ged", "verdicts", "feat-memory.json"),
          JSON.stringify({
            schemaVersion: 2,
            branch: "feat/memory",
            headSha,
            implementer: { driverKind: "codex" },
            reviews: [
              {
                verifier: { driverKind: "claudeAgent" },
                status: "pass",
                criteria: [{ criterion: "It works", verdict: "met", evidence }],
                otherVendorAvailable: true,
              },
            ],
          }),
        );
        const ruling = (yield* call(root, "ged_land_check", {})) as {
          allowed: boolean;
          detail: string;
        };
        expect(ruling.allowed, JSON.stringify(evidence)).toBe(false);
        expect(ruling.detail).toContain("substantive evidence");
      }
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
