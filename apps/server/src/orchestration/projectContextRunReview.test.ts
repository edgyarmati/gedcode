import {
  ProjectContextRunId,
  ProjectId,
  ProviderInstanceId,
  ProjectContextFingerprint,
  ProjectContextRunPath,
  ProjectContextSchemaVersion,
  type OrchestrationProjectContextRun,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { makeProjectContextSnapshot } from "../project/ProjectContext.ts";
import {
  captureProjectContextRunGitState,
  captureProjectContextWorkspaceStatus,
} from "../project/ProjectContextRunChanges.ts";
import { VcsProcess, layer as VcsProcessLive } from "../vcs/VcsProcess.ts";
import {
  commitProjectContextRunReview,
  discardProjectContextRunReview,
  projectContextRunReviewPresentation,
  ProjectContextRunReviewError,
  reconcileProjectContextRunReview,
} from "./projectContextRunReview.ts";

const TestLayer = VcsProcessLive.pipe(Layer.provideMerge(NodeServices.layer));
const now = "2026-07-20T12:00:00.000Z";

const rawDigest = (content: string) =>
  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}` as const;

const git = Effect.fn("ProjectContextRunReviewTest.git")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const process = yield* VcsProcess;
  return yield* process.run({
    operation: "ProjectContextRunReviewTest.git",
    command: "git",
    args,
    cwd,
  });
});

const scanAgents = (runId: OrchestrationProjectContextRun["id"], root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(root, "AGENTS.md");
    const content = (yield* fs.exists(filePath)) ? yield* fs.readFileString(filePath) : null;
    return makeProjectContextSnapshot({
      files: [
        {
          relativePath: "AGENTS.md",
          classification: content === null ? "missing" : "substantive",
          normalizedContent: content ?? "",
        },
      ],
      ownershipBaseline: {
        files: [
          {
            relativePath: "AGENTS.md",
            state:
              content === null
                ? { presence: "absent" as const, digest: null, size: 0, content: null }
                : {
                    presence: "present" as const,
                    digest: rawDigest(content),
                    size: Buffer.byteLength(content, "utf8"),
                    content,
                  },
          },
        ],
      },
    });
  }).pipe(
    Effect.mapError(
      (error) =>
        new (class extends Error {
          readonly projectContextRunId = runId;
          constructor() {
            super(error.message);
          }
        })(),
    ),
  );

const makeRepository = Effect.fn("ProjectContextRunReviewTest.makeRepository")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-context-review-" });
  yield* git(cwd, ["init"]);
  yield* git(cwd, ["config", "user.email", "tests@gedcode.dev"]);
  yield* git(cwd, ["config", "user.name", "GedCode Tests"]);
  yield* fs.writeFileString(`${cwd}/AGENTS.md`, "one\ntwo\nthree\nfour\n");
  yield* fs.writeFileString(`${cwd}/other.txt`, "base\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-m", "Initial fixture"]);
  return cwd;
});

const makeReviewRun = Effect.fn("ProjectContextRunReviewTest.makeReviewRun")(function* (
  cwd: string,
  before: string | null,
  after: string | null,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const process = yield* VcsProcess;
  const workspaceStatusManifest = yield* captureProjectContextWorkspaceStatus({
    workspaceRoot: cwd,
    process,
    fileSystem: fs,
    path,
  });
  const gitState = yield* captureProjectContextRunGitState({
    workspaceRoot: cwd,
    process,
    fileSystem: fs,
    path,
  });
  return {
    id: ProjectContextRunId.make("context-review-1"),
    projectId: ProjectId.make("context-review-project"),
    mode: "review",
    tier: "smart",
    providerInstanceId: ProviderInstanceId.make("context-review-provider"),
    model: "test-model",
    modelOptions: null,
    primaryCheckoutPath: cwd,
    schemaVersion: ProjectContextSchemaVersion.make(1),
    fingerprint: ProjectContextFingerprint.make(`sha256:${"a".repeat(64)}`),
    prompt: "Review project context safely.",
    baselineManifest: [{ path: ProjectContextRunPath.make("AGENTS.md"), rawContent: before }],
    workspaceStatusManifest,
    gitState,
    status: "pending-review",
    pmStartState: "ready",
    providerThreadId: null,
    result: "Updated project instructions.",
    failureMessage: null,
    changes: [
      {
        path: ProjectContextRunPath.make("AGENTS.md"),
        beforeRawContent: before,
        afterRawContent: after,
      },
    ],
    scopeViolationPaths: [],
    resolution: null,
    commitHash: null,
    resultSchemaVersion: null,
    resultFingerprint: null,
    createdAt: now,
    startedAt: now,
    pendingReviewAt: now,
    failedAt: null,
    interruptedAt: null,
    resolvedAt: null,
    updatedAt: now,
  } as OrchestrationProjectContextRun;
});

const reviewServices = Effect.fn("ProjectContextRunReviewTest.reviewServices")(function* (
  run: OrchestrationProjectContextRun,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsProcess = yield* VcsProcess;
  return {
    scan: (root: string) =>
      scanAgents(run.id, root).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.mapError(
          (error) =>
            new ProjectContextRunReviewError({
              projectContextRunId: run.id,
              detail: error.message,
            }),
        ),
      ),
    vcsProcess,
    fileSystem,
    path,
  };
});

it.layer(TestLayer)("project-context run review", (it) => {
  it.effect(
    "commits only the provider hunk while retaining pre-existing same-file unstaged user work",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const cwd = yield* makeRepository();
          const before = "one\ntwo\nthree\nUSER four\n";
          const after = "ONE\ntwo\nthree\nUSER four\n";
          yield* fs.writeFileString(`${cwd}/AGENTS.md`, before);
          const run = yield* makeReviewRun(cwd, before, after);
          const services = yield* reviewServices(run);
          yield* fs.writeFileString(`${cwd}/AGENTS.md`, after);

          const result = yield* commitProjectContextRunReview(
            services,
            run,
            "docs: update project instructions",
          );

          assert.match(result.commitSha ?? "", /^[a-f0-9]{40}$/u);
          assert.equal(
            (yield* git(cwd, ["show", "HEAD:AGENTS.md"])).stdout,
            "ONE\ntwo\nthree\nfour\n",
          );
          assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), after);
          assert.match(
            (yield* git(cwd, ["show", "-s", "--format=%B", "HEAD"])).stdout,
            /GedCode-Project-Context-Run: context-review-1/u,
          );
        }),
      ),
  );

  it.effect("commits after an unrelated branch is created after the run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nfour\n";
        const after = "ONE\ntwo\nthree\nfour\n";
        const run = yield* makeReviewRun(cwd, before, after);
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, after);
        yield* git(cwd, ["branch", "unrelated-task"]);

        const result = yield* commitProjectContextRunReview(
          services,
          run,
          "docs: update project instructions",
        );

        assert.match(result.commitSha ?? "", /^[a-f0-9]{40}$/u);
        assert.equal(
          (yield* git(cwd, ["rev-parse", "unrelated-task"])).stdout.trim(),
          run.gitState.head,
        );
        assert.equal((yield* git(cwd, ["show", "HEAD:AGENTS.md"])).stdout, after);
      }),
    ),
  );

  it.effect("still rejects review when the checked-out branch advances after the run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nfour\n";
        const after = "ONE\ntwo\nthree\nfour\n";
        const run = yield* makeReviewRun(cwd, before, after);
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, after);
        yield* git(cwd, ["commit", "--allow-empty", "-m", "Concurrent repository change"]);

        const error = yield* Effect.flip(
          commitProjectContextRunReview(services, run, "docs: update project instructions"),
        );

        assert.match(error.message, /Git state changed since the run: \.git\/HEAD/u);
        assert.deepEqual(error.conflict, {
          kind: "head-drift",
          detail: error.detail,
          paths: [".git/HEAD"],
          autoReconcile: true,
          actions: ["retry", "reconcile", "hand-to-pm", "discard"],
        });
        assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), after);
      }),
    ),
  );

  it.effect("renders persisted review evidence without checking the live checkout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* makeRepository();
        const run = yield* makeReviewRun(
          cwd,
          "one\ntwo\nthree\nUSER four\n",
          "ONE\ntwo\nthree\nUSER four\n",
        );

        const review = projectContextRunReviewPresentation({
          ...run,
          scopeViolationPaths: [ProjectContextRunPath.make("CONTEXT.md")],
        });

        assert.equal(review.runId, run.id);
        assert.equal(review.result, "Updated project instructions.");
        assert.deepEqual(review.changes, [
          { path: ProjectContextRunPath.make("AGENTS.md"), kind: "modified" },
        ]);
        assert.match(review.diff, /diff --project-context a\/AGENTS\.md b\/AGENTS\.md/u);
        assert.deepEqual(review.scopeViolationPaths, [ProjectContextRunPath.make("CONTEXT.md")]);
      }),
    ),
  );

  it.effect("rejects staged work without touching the index or working tree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nUSER four\n";
        const after = "ONE\ntwo\nthree\nUSER four\n";
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, before);
        yield* fs.writeFileString(`${cwd}/other.txt`, "staged user work\n");
        yield* git(cwd, ["add", "other.txt"]);
        const run = yield* makeReviewRun(cwd, before, after);
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, after);

        const error = yield* Effect.flip(
          commitProjectContextRunReview(services, run, "docs: update project instructions"),
        );
        assert.match(error.message, /clean Git index/u);
        assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), after);
        assert.equal(
          (yield* git(cwd, ["diff", "--cached", "--", "other.txt"])).stdout.length > 0,
          true,
        );
      }),
    ),
  );

  it.effect("rejects a stale reviewed file without staging or overwriting the newer edit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nfour\n";
        const after = "ONE\ntwo\nthree\nfour\n";
        const newer = "ONE\ntwo\nthree\nnewer user edit\n";
        const run = yield* makeReviewRun(cwd, before, after);
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, newer);

        const error = yield* Effect.flip(
          commitProjectContextRunReview(services, run, "docs: update project instructions"),
        );

        assert.match(error.message, /review is stale/u);
        assert.equal(error.conflict?.kind, "context-drift");
        assert.equal(error.conflict?.autoReconcile, true);
        assert.deepEqual(error.conflict?.paths, ["AGENTS.md"]);
        assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), newer);
        assert.equal((yield* git(cwd, ["diff", "--cached", "--quiet"])).exitCode, 0);
        assert.match(
          (yield* git(cwd, ["show", "-s", "--format=%s", "HEAD"])).stdout,
          /Initial fixture/u,
        );
      }),
    ),
  );

  it.effect("reconciles non-overlapping provider and current context edits", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nfour\n";
        const proposal = "ONE\ntwo\nthree\nfour\n";
        const current = "one\ntwo\nthree\nUSER four\n";
        const run = yield* makeReviewRun(cwd, before, proposal);
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, current);

        yield* reconcileProjectContextRunReview(services, run);

        assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), "ONE\ntwo\nthree\nUSER four\n");
      }),
    ),
  );

  it.effect("refuses overlapping context reconciliation without changing the file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nfour\n";
        const proposal = "ONE\ntwo\nthree\nfour\n";
        const current = "USER ONE\ntwo\nthree\nfour\n";
        const run = yield* makeReviewRun(cwd, before, proposal);
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, current);

        const error = yield* Effect.flip(reconcileProjectContextRunReview(services, run));

        assert.match(error.detail, /edits overlap/u);
        assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), current);
      }),
    ),
  );

  it.effect("requires PM handoff to clear out-of-scope residue before settling", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nfour\n";
        const proposal = "ONE\ntwo\nthree\nfour\n";
        const run = {
          ...(yield* makeReviewRun(cwd, before, proposal)),
          scopeViolationPaths: ["other.txt"],
        } as OrchestrationProjectContextRun;
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, proposal);
        yield* fs.writeFileString(`${cwd}/other.txt`, "provider residue\n");

        const blocked = yield* Effect.flip(
          reconcileProjectContextRunReview(services, run, {
            allowRecordedScopeViolation: true,
          }),
        );
        assert.match(blocked.detail, /must resolve out-of-scope/u);

        yield* fs.writeFileString(`${cwd}/other.txt`, "base\n");
        yield* reconcileProjectContextRunReview(services, run, {
          allowRecordedScopeViolation: true,
        });
        assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), proposal);
      }),
    ),
  );

  it.effect("discards only provider context content and restores its exact dirty baseline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository();
        const before = "one\ntwo\nthree\nUSER four\n";
        const after = "ONE\ntwo\nthree\nUSER four\n";
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, before);
        yield* fs.writeFileString(`${cwd}/other.txt`, "unrelated user work\n");
        const run = yield* makeReviewRun(cwd, before, after);
        const services = yield* reviewServices(run);
        yield* fs.writeFileString(`${cwd}/AGENTS.md`, after);

        yield* discardProjectContextRunReview(services, run);

        assert.equal(yield* fs.readFileString(`${cwd}/AGENTS.md`), before);
        assert.equal(yield* fs.readFileString(`${cwd}/other.txt`), "unrelated user work\n");
      }),
    ),
  );
});
