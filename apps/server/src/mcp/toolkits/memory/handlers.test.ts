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

import { LAND_GATE, LEGACY_LAND_GATE, OPT_OUT_LAND_GATE } from "../../../ged/starter/landGate.ts";
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
      expect(playbook.content).toContain("selectionReason");
      const lead = (yield* call(root, "ged_playbook", { name: "lead" })) as { content: string };
      for (const instruction of [
        "Prefer cross-vendor",
        "Automatic same-provider fallback",
        "Unknown quota telemetry is not confirmed exhaustion",
        "Do not repeatedly",
        "two independent fresh review contexts",
        "never erase them through fallback",
        "report review pending/unavailable",
      ])
        expect(lead.content).toContain(instruction);
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
      const missing = yield* landCheck(root);
      expect(missing.allowed).toBe(false);
      expect(missing.detail).toContain("no verdict record");
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

it.effect("accepts same-provider review with a warning even when another vendor is installed", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const headSha = git(root, "rev-parse", "HEAD");
      // Padding and case must not hide that this is same-provider review.
      const written = (yield* call(root, "ged_verdict_write", {
        ...ruling(headSha, { driverKind: " Codex " }),
        verifier: { driverKind: " Codex ", taskId: "fresh-review-1" },
      })) as { ruling: string };
      expect(written.ruling).toMatch(/^allowed/);
      const checked = yield* landCheck(root);
      expect(checked.allowed).toBe(true);
      expect(checked.detail).toContain("WARNING: same-provider review");
      expect(checked.detail).toContain("another vendor was installed");
      expect(checked.detail).not.toContain("SKIPPED");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "records fallback reasons without falsifying availability and retains two fresh reviews",
  () =>
    withCheckout((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const headSha = git(root, "rev-parse", "HEAD");
        const selectionReason =
          "Other vendor is out of quota; using a fresh strong same-provider reviewer";
        for (const taskId of ["fresh-review-1", "fresh-review-2"]) {
          const written = (yield* call(root, "ged_verdict_write", {
            ...ruling(headSha, { driverKind: "codex" }),
            verifier: { driverKind: "codex", taskId },
            selectionReason,
            otherVendorAvailable: false, // Untrusted input cannot override the server's catalog.
          })) as { ruling: string };
          expect(written.ruling).toMatch(/^allowed/);
          expect(written.ruling).toContain(selectionReason);
        }
        const record = yield* fs.readFileString(`${root}/.ged/verdicts/feat-memory.json`);
        const { reviews } = JSON.parse(record) as {
          reviews: ReadonlyArray<{ otherVendorAvailable: boolean; selectionReason: string }>;
        };
        expect(reviews).toHaveLength(2);
        for (const review of reviews) {
          expect(review).toMatchObject({ otherVendorAvailable: true, selectionReason });
        }
        const checked = yield* landCheck(root);
        expect(checked.allowed).toBe(true);
        expect(checked.detail).toContain("2 review(s) passed");
        expect(checked.detail).toContain(selectionReason);
        // Exercise the standalone entry point as well as ged_land_check.
        const standalone = NodeChildProcess.spawnSync("sh", [".ged/bin/land-gate.sh"], {
          cwd: root,
          encoding: "utf8",
        });
        expect(standalone.status).toBe(0);
        expect(standalone.stderr).toContain("WARNING: same-provider review");
        expect(standalone.stderr).toContain(selectionReason);
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
      yield* call(root, "ged_verdict_write", {
        ...ruling(headSha, { driverKind: "claudeAgent" }),
        status: "fail",
      });
      yield* call(root, "ged_verdict_write", {
        ...ruling(headSha, { driverKind: "codex", model: "gpt-6-sol" }),
        selectionReason: "Foreign provider later became unavailable",
      });
      const checked = yield* landCheck(root);
      expect(checked.allowed).toBe(false);
      expect(checked.detail).toContain('status "fail"');
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
        ["stale verdict", record({ headSha: "0".repeat(40) })],
        ["wrong branch", record({ branch: "another-branch" })],
        ["no criteria", record({ reviews: [{ ...review, criteria: [] }] })],
        [
          "no availability flag",
          record({ reviews: [{ ...review, otherVendorAvailable: undefined }] }),
        ],
        ...["not_met", "unverifiable"].map(
          (verdict) =>
            [
              verdict,
              record({ reviews: [{ ...review, criteria: [{ ...review.criteria[0], verdict }] }] }),
            ] as [string, unknown],
        ),
        ["invalid reason type", record({ reviews: [{ ...review, selectionReason: false }] })],
        ["empty reason", record({ reviews: [{ ...review, selectionReason: " " }] })],
        [
          "unbounded reason",
          record({ reviews: [{ ...review, selectionReason: "x".repeat(501) }] }),
        ],
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
      yield* fs.writeFileString(file, "{ malformed JSON");
      expect((yield* landCheck(root)).allowed).toBe(false);
      yield* fs.writeFileString(file, JSON.stringify(record({})));
      expect((yield* landCheck(root)).allowed).toBe(true);
      const outside = `${root}/outside.json`;
      // Keep the target ignored so the verdict symlink is the gate's rejection reason.
      yield* fs.writeFileString(`${root}/.git/info/exclude`, "outside.json\n");
      yield* fs.rename(file, outside);
      yield* fs.symlink(outside, file);
      const symlinked = yield* landCheck(root);
      expect(symlinked.allowed).toBe(false);
      expect(symlinked.detail).toContain("symlink");
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

const policy = (root: string) =>
  call(root, "ged_memory_list", {}).pipe(
    Effect.map(
      (result) => (result as { reviewPolicy: typeof ProjectMemory.ReviewStatus.Type }).reviewPolicy,
    ),
  );

const setPolicy = (
  root: string,
  scope: "project" | "change",
  mode: "skip" | "required",
  extra = {},
) =>
  call(root, "ged_review_policy_set", { scope, mode, reason: "Explicit user request", ...extra });

it.effect("defaults to required, persists project skip across calls, and fully reverses it", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      expect(yield* policy(root)).toMatchObject({ required: true, valid: true, gate: "current" });
      expect((yield* landCheck(root)).allowed).toBe(false);
      const skipped = yield* setPolicy(root, "project", "skip");
      expect(skipped).toMatchObject({
        required: false,
        scope: "project",
        reason: "Explicit user request",
      });
      expect(yield* policy(root)).toMatchObject({ required: false, projectMode: "skip" });
      const gate = yield* landCheck(root);
      expect(gate.allowed).toBe(true);
      expect(gate.detail).toContain("review SKIPPED (project)");
      expect(gate.detail).not.toContain("passed");
      yield* setPolicy(root, "change", "skip", {
        branch: "feat/memory",
        headSha: git(root, "rev-parse", "HEAD"),
      });
      expect(yield* setPolicy(root, "change", "required")).toMatchObject({
        required: false,
        scope: "project",
      });
      // Re-add a change exemption: project reset must remove this too.
      yield* setPolicy(root, "change", "skip", {
        branch: "feat/memory",
        headSha: git(root, "rev-parse", "HEAD"),
      });
      yield* setPolicy(root, "project", "required");
      expect(yield* policy(root)).toMatchObject({
        required: true,
        projectMode: "required",
        scope: null,
      });
      expect((yield* landCheck(root)).allowed).toBe(false);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "binds a change skip to the full branch and final commit, never a later HEAD or old ref",
  () =>
    withCheckout((root) =>
      Effect.gen(function* () {
        const headSha = git(root, "rev-parse", "HEAD");
        expect(String(yield* setPolicy(root, "change", "skip"))).toContain("exact current branch");
        expect(
          String(yield* setPolicy(root, "change", "skip", { branch: "feat-memory", headSha })),
        ).toContain("exact current branch");
        yield* setPolicy(root, "change", "skip", { branch: "feat/memory", headSha });
        expect(yield* policy(root)).toMatchObject({ required: false, scope: "change", headSha });
        expect((yield* landCheck(root)).detail).toContain("review SKIPPED (change)");
        git(root, "switch", "-c", "feat-memory"); // Same slug, different full branch.
        expect(yield* policy(root)).toMatchObject({ required: true });
        expect((yield* landCheck(root)).allowed).toBe(false);
        git(root, "switch", "feat/memory");
        git(root, "commit", "--allow-empty", "-m", "later commit");
        expect(yield* policy(root)).toMatchObject({ required: true });
        expect((yield* landCheck(root)).allowed).toBe(false);
        const oldRef = NodeChildProcess.spawnSync("sh", [".ged/bin/land-gate.sh", headSha], {
          cwd: root,
          encoding: "utf8",
        });
        expect(oldRef.status).toBe(1);
        expect(oldRef.stdout).not.toContain("SKIPPED");
        yield* setPolicy(root, "change", "skip", {
          branch: "feat/memory",
          headSha: git(root, "rev-parse", "HEAD"),
        });
        yield* setPolicy(root, "change", "required");
        expect(yield* policy(root)).toMatchObject({ required: true });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("shares local project policy with linked worktrees but isolates change exemptions", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const parent = yield* fs.makeTempDirectoryScoped();
      const worktree = `${parent}/linked`;
      git(root, "worktree", "add", "-b", "other", worktree);
      yield* setPolicy(root, "change", "skip", {
        branch: "feat/memory",
        headSha: git(root, "rev-parse", "HEAD"),
      });
      expect(yield* policy(worktree)).toMatchObject({ required: true });
      yield* setPolicy(root, "project", "skip");
      expect(yield* policy(worktree)).toMatchObject({ required: false, scope: "project" });
      expect((yield* landCheck(worktree)).allowed).toBe(true);
      yield* setPolicy(worktree, "project", "required");
      expect(yield* policy(root)).toMatchObject({ required: true });
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("retains clean-tree, attached-branch and ref checks even with project skip", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(`${root}/uncommitted`, "work");
      expect(
        String(
          yield* setPolicy(root, "change", "skip", {
            branch: "feat/memory",
            headSha: git(root, "rev-parse", "HEAD"),
          }),
        ),
      ).toContain("clean the working tree");
      yield* setPolicy(root, "project", "skip");
      expect((yield* landCheck(root)).detail).toContain("working tree is dirty");
      yield* fs.remove(`${root}/uncommitted`);
      const invalidRef = NodeChildProcess.spawnSync(
        "sh",
        [".ged/bin/land-gate.sh", "no-such-ref"],
        { cwd: root },
      );
      expect(invalidRef.status).toBe(2);
      git(root, "switch", "--detach");
      expect((yield* landCheck(root)).detail).toContain("detached HEAD");
      expect(
        String(
          yield* setPolicy(root, "change", "skip", {
            branch: "feat/memory",
            headSha: git(root, "rev-parse", "HEAD"),
          }),
        ),
      ).toContain("attached");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "fails closed on invalid policy and recovers only through explicit project required",
  () =>
    withCheckout((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = `${root}/.git/ged`;
        yield* fs.makeDirectory(dir);
        const change = {
          branch: "feat/memory",
          headSha: git(root, "rev-parse", "HEAD"),
          reason: "User request",
        };
        const valid = { schemaVersion: 1, project: { reason: "User request" }, changes: [] };
        for (const value of [
          "{",
          JSON.stringify({ ...valid, schemaVersion: 9 }),
          JSON.stringify({ ...valid, changes: [null] }),
          JSON.stringify({ ...valid, changes: [change, change] }),
          JSON.stringify({ ...valid, project: { reason: "\u200b\u202e " } }),
          JSON.stringify({ ...valid, project: { reason: "\u0000" } }),
          JSON.stringify({ ...valid, changes: [{ ...change, headSha: "*" }] }),
        ]) {
          yield* fs.writeFileString(`${dir}/review-policy.json`, value);
          expect(yield* policy(root)).toMatchObject({ required: true, valid: false });
          expect((yield* landCheck(root)).allowed).toBe(false);
          expect(String(yield* setPolicy(root, "project", "skip"))).toContain("BLOCKED");
          expect(yield* fs.readFileString(`${dir}/review-policy.json`)).toBe(value);
        }
        yield* setPolicy(root, "project", "required");
        expect(yield* policy(root)).toMatchObject({ required: true, valid: true });
        // Policy reads must never follow even a dangling link or a linked directory.
        yield* fs.remove(`${dir}/review-policy.json`);
        yield* fs.symlink(`${root}/outside.json`, `${dir}/review-policy.json`);
        expect(yield* policy(root)).toMatchObject({ required: true, valid: false });
        expect((yield* landCheck(root)).allowed).toBe(false);
        expect(String(yield* setPolicy(root, "project", "required"))).toContain("symlink");
        expect(yield* fs.exists(`${root}/outside.json`)).toBe(false);
        yield* fs.remove(`${dir}/review-policy.json`);
        yield* fs.remove(dir, { recursive: true });
        const outside = yield* fs.makeTempDirectoryScoped();
        yield* fs.symlink(outside, dir);
        expect(yield* policy(root)).toMatchObject({ required: true, valid: false });
        expect(String(yield* setPolicy(root, "project", "skip"))).toContain("symlink");
        expect(yield* fs.readDirectory(outside)).toEqual([]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "previews and explicitly upgrades only the stock legacy gate, preserving custom gates",
  () =>
    withCheckout((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const gate = `${root}/.ged/bin/land-gate.sh`;
        yield* fs.writeFileString(gate, LEGACY_LAND_GATE);
        git(root, "add", "-A");
        git(root, "commit", "-m", "legacy gate");
        expect(yield* call(root, "ged_review_gate_update", {})).toEqual({
          status: "legacy",
          applied: false,
        });
        expect(yield* fs.readFileString(gate)).toBe(LEGACY_LAND_GATE);
        expect(yield* policy(root)).toMatchObject({ required: true, gate: "legacy" });
        expect(yield* call(root, "ged_review_gate_update", { apply: true })).toEqual({
          status: "current",
          applied: true,
        });
        expect(yield* fs.readFileString(gate)).toBe(LAND_GATE);
        git(root, "add", "-A");
        git(root, "commit", "-m", "upgrade gate");
        yield* setPolicy(root, "project", "skip");
        expect((yield* landCheck(root)).allowed).toBe(true);
        yield* setPolicy(root, "project", "required");
        expect((yield* landCheck(root)).allowed).toBe(false);
        // The manual-opt-out stock gate is also a supported legacy version.
        yield* fs.writeFileString(gate, OPT_OUT_LAND_GATE);
        expect(yield* policy(root)).toMatchObject({ gate: "legacy", gateSupportsOptOut: true });
        expect(yield* call(root, "ged_review_gate_update", {})).toEqual({
          status: "legacy",
          applied: false,
        });
        expect(yield* fs.readFileString(gate)).toBe(OPT_OUT_LAND_GATE);
        expect(yield* call(root, "ged_review_gate_update", { apply: true })).toEqual({
          status: "current",
          applied: true,
        });
        expect(yield* fs.readFileString(gate)).toBe(LAND_GATE);
        const custom = `${LAND_GATE}\n# custom hook\n`;
        yield* fs.writeFileString(gate, custom);
        expect(yield* call(root, "ged_review_gate_update", {})).toEqual({
          status: "custom",
          applied: false,
        });
        expect(String(yield* call(root, "ged_review_gate_update", { apply: true }))).toContain(
          "exact stock legacy",
        );
        expect(yield* fs.readFileString(gate)).toBe(custom);
        yield* fs.remove(gate);
        expect(yield* call(root, "ged_review_gate_update", {})).toEqual({
          status: "missing",
          applied: false,
        });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "exposes status to read-only callers but refuses policy mutations and gate upgrades",
  () =>
    withCheckout((root) =>
      Effect.gen(function* () {
        const client = { sessionId: "reader", label: "reader", access: "read-only" as const };
        expect(yield* call(root, "ged_memory_list", {}, undefined, client)).toMatchObject({
          reviewPolicy: { required: true },
        });
        for (const [name, args] of [
          ["ged_review_policy_set", { scope: "project", mode: "skip", reason: "User request" }],
          ["ged_review_gate_update", { apply: true }],
        ] as const) {
          expect(String(yield* call(root, name, args, undefined, client))).toContain("read-only");
        }
        expect(yield* policy(root)).toMatchObject({ required: true });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps inherited opt-outs inactive until the checkout's gate supports them", () =>
  withCheckout((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const parent = yield* fs.makeTempDirectoryScoped();
      const linked = `${parent}/linked`;
      git(root, "worktree", "add", "-b", "old-gate", linked);
      yield* fs.writeFileString(`${linked}/.ged/bin/land-gate.sh`, LEGACY_LAND_GATE);
      git(linked, "add", "-A");
      git(linked, "commit", "-m", "retain old gate");
      yield* setPolicy(root, "project", "skip");
      expect(yield* policy(root)).toMatchObject({ required: false, gateSupportsOptOut: true });
      expect(yield* policy(linked)).toMatchObject({
        required: true,
        valid: true,
        projectMode: "skip",
        scope: null,
        gate: "legacy",
        gateSupportsOptOut: false,
        error: expect.stringContaining("needs review-policy support"),
      });
      expect((yield* landCheck(linked)).allowed).toBe(false);
      const before = yield* fs.readFileString(`${root}/.git/ged/review-policy.json`);
      expect(String(yield* setPolicy(linked, "project", "skip"))).toContain(
        "does not support review opt-outs",
      );
      expect(yield* fs.readFileString(`${root}/.git/ged/review-policy.json`)).toBe(before);
      // Reversal must work even before upgrading an older worktree.
      expect(yield* setPolicy(linked, "project", "required")).toMatchObject({
        required: true,
        projectMode: "required",
      });
      yield* call(linked, "ged_review_gate_update", { apply: true });
      git(linked, "add", "-A");
      git(linked, "commit", "-m", "upgrade gate");
      yield* setPolicy(root, "project", "skip");
      expect(yield* policy(linked)).toMatchObject({ required: false, gateSupportsOptOut: true });
      expect((yield* landCheck(linked)).allowed).toBe(true);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "preserves custom checks with either opt-out and default verdict checks after reset",
  () =>
    withCheckout((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = `${root}/.ged/bin/land-gate.sh`;
        const custom = LAND_GATE.replace(
          "set -eu",
          'set -eu\nif ! git config --local --get test.customReady >/dev/null; then\n  echo "BLOCKED: custom check" >&2\n  exit 1\nfi',
        );
        yield* fs.writeFileString(file, custom);
        git(root, "add", "-A");
        git(root, "commit", "-m", "custom gate integration");
        expect(yield* policy(root)).toMatchObject({ gate: "custom", gateSupportsOptOut: true });
        const headSha = git(root, "rev-parse", "HEAD");
        for (const scope of ["project", "change"] as const) {
          yield* setPolicy(root, scope, "skip", { branch: "feat/memory", headSha });
          expect((yield* landCheck(root)).detail).toContain("BLOCKED: custom check");
          git(root, "config", "--local", "test.customReady", "true");
          expect((yield* landCheck(root)).detail).toContain(`review SKIPPED (${scope})`);
          yield* setPolicy(root, "project", "required");
          expect((yield* landCheck(root)).detail).toContain("no verdict record");
          git(root, "config", "--local", "--unset", "test.customReady");
        }
        expect(String(yield* call(root, "ged_review_gate_update", { apply: true }))).toContain(
          "exact stock legacy",
        );
        expect(yield* fs.readFileString(file)).toBe(custom);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "serializes concurrent policy updates across linked worktrees without losing either branch",
  () =>
    withCheckout((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped();
        const linked = `${parent}/linked`;
        git(root, "worktree", "add", "-b", "other", linked);
        yield* Effect.gen(function* () {
          const memory = yield* ProjectMemory.ProjectMemory;
          const headSha = git(root, "rev-parse", "HEAD");
          yield* Effect.all(
            [
              memory.setReviewPolicy(root, {
                scope: "change",
                mode: "skip",
                reason: "User request one",
                branch: "feat/memory",
                headSha,
              }),
              memory.setReviewPolicy(linked, {
                scope: "change",
                mode: "skip",
                reason: "User request two",
                branch: "other",
                headSha,
              }),
            ],
            { concurrency: "unbounded" },
          );
          expect(yield* memory.reviewStatus(root)).toMatchObject({
            required: false,
            scope: "change",
          });
          expect(yield* memory.reviewStatus(linked)).toMatchObject({
            required: false,
            scope: "change",
          });
          const files = yield* fs.readDirectory(`${root}/.git/ged`);
          expect(files).toEqual(["review-policy.json"]); // No partial/temp files remain.
        }).pipe(Effect.provide(ProjectMemory.layer.pipe(Layer.provide(NodeServices.layer))));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);
