import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ProcessRunner from "../processRunner.ts";
import { mergeRuling, type VerdictRuling } from "./verdictRecord.ts";
import {
  REVIEW_POLICY_SCRIPT,
  ReviewPolicyInput,
  ReviewPolicyStatus,
  ReviewGateStatus,
} from "./reviewPolicyScript.ts";
import {
  LAND_GATE,
  LEGACY_LAND_GATE,
  OPT_OUT_LAND_GATE,
  REVIEW_POLICY_GATE_MARKER,
} from "./starter/landGate.ts";

/**
 * The Ged project memory: the `.ged/` tree a project keeps alongside its code.
 *
 * It holds the project's standards, decision log, context map, model notes,
 * plans, and the verdict records the land gate reads. Serving it through MCP is
 * what makes it available to every provider — a Codex worker and a Claude worker
 * read the same standards, which is the whole point of keeping them on disk
 * rather than in one harness's prompt.
 *
 * Document access is path-confined to `<root>/.ged`. Local review policy has a
 * separate, fixed accessor anchored to Git's canonical common directory. Tool input names a document
 * by a relative key, never a path the caller composes, and no symlink is followed
 * on the way to it: a checkout is untrusted input, and one link inside `.ged` would
 * otherwise reach any file the server can read or write.
 */

const MEMORY_DIR = ".ged";
const VERDICTS_DIR = "verdicts";
const GATE_SCRIPT = "bin/land-gate.sh";

/** Documents an agent may read. Anything outside this set is not memory. */
const READABLE_EXTENSIONS = new Set([".md", ".json"]);

/** Ceiling on a single document, so a stray large file cannot flood a context window. */
const MAX_DOCUMENT_BYTES = 256 * 1024;

export interface MemoryDocument {
  readonly key: string;
  readonly bytes: number;
}

export interface LandRuling {
  readonly allowed: boolean;
  /** `error` means the gate could not evaluate — an unusable ref, a detached HEAD. */
  readonly outcome: "allowed" | "blocked" | "error";
  readonly detail: string;
}

export const ReviewStatus = Schema.Struct({
  ...ReviewPolicyStatus.fields,
  gate: ReviewGateStatus,
  gateSupportsOptOut: Schema.Boolean,
});
export const GateUpdate = Schema.Struct({ status: ReviewGateStatus, applied: Schema.Boolean });
const decodePolicyStatus = Schema.decodeUnknownEffect(Schema.fromJsonString(ReviewPolicyStatus));
const decodePolicyInput = Schema.decodeUnknownEffect(ReviewPolicyInput);

export class GedMemoryError extends Error {
  readonly _tag = "GedMemoryError";
  constructor(message: string) {
    super(message);
    this.name = "GedMemoryError";
  }
}

export class ProjectMemory extends Context.Service<
  ProjectMemory,
  {
    /** Whether this checkout carries a Ged memory tree at all. */
    readonly present: (root: string) => Effect.Effect<boolean>;
    readonly list: (root: string) => Effect.Effect<ReadonlyArray<MemoryDocument>, GedMemoryError>;
    readonly read: (root: string, key: string) => Effect.Effect<string, GedMemoryError>;
    /** Adds one verifier's ruling to the branch's verdict record; returns its key. */
    readonly recordRuling: (
      root: string,
      ruling: VerdictRuling,
    ) => Effect.Effect<string, GedMemoryError>;
    readonly landCheck: (root: string) => Effect.Effect<LandRuling, GedMemoryError>;
    readonly reviewStatus: (
      root: string,
    ) => Effect.Effect<typeof ReviewStatus.Type, GedMemoryError>;
    readonly setReviewPolicy: (
      root: string,
      input: typeof ReviewPolicyInput.Type,
    ) => Effect.Effect<typeof ReviewStatus.Type, GedMemoryError>;
    readonly updateReviewGate: (
      root: string,
      apply: boolean,
    ) => Effect.Effect<typeof GateUpdate.Type, GedMemoryError>;
  }
>()("t3/ged/ProjectMemory") {}

/**
 * A memory key is a relative path inside `.ged`. It is validated rather than
 * sanitised: a key that could escape the tree is rejected outright, so no
 * normalisation step can quietly turn a bad key into a readable one.
 */
const validateKey = (key: string): string | undefined => {
  if (key.length === 0 || key.length > 200) return "A memory key must be 1-200 characters.";
  if (key.startsWith("/") || key.includes("\\")) return "A memory key is a relative POSIX path.";
  if (key.includes("\0")) return "A memory key may not contain a null byte.";
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return "A memory key may not contain empty, '.' or '..' segments.";
  if (!/^[A-Za-z0-9._/-]+$/.test(key))
    return "A memory key may contain only letters, digits, '.', '_', '-' and '/'.";
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || !READABLE_EXTENSIONS.has(key.slice(dot)))
    return "A memory document is a .md or .json file.";
  return undefined;
};

/**
 * The verdict filename the land gate looks for. This must stay identical to the
 * slug rule in `.ged/bin/land-gate.sh`; a divergence would let an agent write a
 * record the gate never reads, which fails open in the one place that matters.
 */
export const verdictSlug = (branch: string): string | undefined => {
  const slug = branch.replaceAll("/", "-");
  if (slug.length === 0 || slug.startsWith("-") || slug === "HEAD") return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) return undefined;
  if (slug.includes("..")) return undefined;
  return slug;
};

const make = Effect.fn("ged.ProjectMemory.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;

  const memoryRoot = (root: string) => path.join(root, MEMORY_DIR);

  const fail = (message: string) => Effect.fail(new GedMemoryError(message));

  const present = (root: string) =>
    fs.exists(memoryRoot(root)).pipe(Effect.orElseSucceed(() => false));

  /**
   * `.ged` resolved through the root's own real path. A `.ged` that is itself a
   * symlink is refused, since everything beneath it would then live elsewhere.
   */
  const realMemoryRoot = (root: string) =>
    Effect.gen(function* () {
      const missing = () => new GedMemoryError(`This project has no ${MEMORY_DIR}/ memory tree.`);
      const expected = path.join(
        yield* fs.realPath(root).pipe(Effect.mapError(missing)),
        MEMORY_DIR,
      );
      const actual = yield* fs.realPath(expected).pipe(Effect.mapError(missing));
      if (actual !== expected)
        return yield* fail(`${MEMORY_DIR}/ is a symlink; refusing to follow it.`);
      return expected;
    });

  /**
   * Whether `full`, built from a real directory and a validated key, resolves to
   * itself, i.e. no component of it is a symlink. Missing paths are `undefined`.
   */
  const resolvesToItself = (full: string) =>
    fs.realPath(full).pipe(
      Effect.map((real) => real === full),
      Effect.orElseSucceed(() => undefined),
    );

  /** Whether `file` is a symlink, dangling or not. `readLink` fails on anything else. */
  const isSymlink = (file: string) =>
    fs.readLink(file).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  /**
   * Walks a real directory under `.ged`, skipping dotfiles, symlinks, and anything
   * unreadable. Skipping links also keeps a link back up the tree from looping.
   */
  const walk = (
    dir: string,
    prefix: string,
  ): Effect.Effect<ReadonlyArray<MemoryDocument>, GedMemoryError> =>
    fs.readDirectory(dir).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.flatMap((entries) =>
        Effect.forEach([...entries].sort(), (entry) =>
          Effect.gen(function* () {
            if (entry.startsWith(".")) return [] as ReadonlyArray<MemoryDocument>;
            const full = path.join(dir, entry);
            const key = prefix === "" ? entry : `${prefix}/${entry}`;
            if ((yield* resolvesToItself(full)) !== true) return [];
            const info = yield* fs.stat(full).pipe(Effect.orElseSucceed(() => undefined));
            if (info === undefined) return [];
            if (info.type === "Directory") return yield* walk(full, key);
            if (info.type !== "File") return [];
            if (validateKey(key) !== undefined) return [];
            return [{ key, bytes: Number(info.size) }];
          }),
        ),
      ),
      Effect.map((groups) => groups.flat()),
    );

  const list = (root: string) =>
    Effect.gen(function* () {
      if (!(yield* present(root)))
        return yield* fail(`This project has no ${MEMORY_DIR}/ memory tree.`);
      return yield* walk(yield* realMemoryRoot(root), "");
    });

  const read = (root: string, key: string) =>
    Effect.gen(function* () {
      const problem = validateKey(key);
      if (problem !== undefined) return yield* fail(problem);
      const full = path.join(yield* realMemoryRoot(root), key);
      // A symlink could point anywhere; the key check above does not cover it.
      const direct = yield* resolvesToItself(full);
      if (direct === undefined) return yield* fail(`No memory document '${key}'.`);
      if (!direct)
        return yield* fail(`'${key}' is reached through a symlink; refusing to follow it.`);
      const info = yield* fs
        .stat(full)
        .pipe(Effect.mapError(() => new GedMemoryError(`No memory document '${key}'.`)));
      if (info.type !== "File") return yield* fail(`'${key}' is not a readable document.`);
      if (Number(info.size) > MAX_DOCUMENT_BYTES)
        return yield* fail(
          `'${key}' is ${Number(info.size)} bytes; the limit is ${MAX_DOCUMENT_BYTES}.`,
        );
      return yield* fs
        .readFileString(full)
        .pipe(Effect.mapError(() => new GedMemoryError(`'${key}' could not be read.`)));
    });

  // Parallel verifiers record into the same file; each read-merge-write must see
  // the previous one's result.
  const verdictLock = yield* Semaphore.make(1);
  const policyLock = yield* Semaphore.make(1);

  const gateStatus = (root: string) =>
    Effect.gen(function* () {
      const file = path.join(memoryRoot(root), GATE_SCRIPT);
      if (yield* isSymlink(file)) return { status: "custom", supportsOptOut: false } as const;
      if (!(yield* fs.exists(file))) return { status: "missing", supportsOptOut: false } as const;
      const dir = yield* realMemoryRoot(root);
      if ((yield* resolvesToItself(path.join(dir, "bin"))) !== true)
        return { status: "custom", supportsOptOut: false } as const;
      const body = yield* fs.readFileString(file);
      const status =
        body === LAND_GATE
          ? ("current" as const)
          : body === LEGACY_LAND_GATE || body === OPT_OUT_LAND_GATE
            ? ("legacy" as const)
            : ("custom" as const);
      return { status, supportsOptOut: body.split(/\r?\n/).includes(REVIEW_POLICY_GATE_MARKER) };
    }).pipe(Effect.mapError(() => new GedMemoryError("Could not inspect the review gate.")));

  const runPolicy = (root: string, input?: typeof ReviewPolicyInput.Type) =>
    Effect.gen(function* () {
      const output = yield* processes
        .run({
          command: "node",
          args: ["--input-type=module", "-e", REVIEW_POLICY_SCRIPT, input ? "set" : "status"],
          cwd: root,
          // Structured input goes over stdin, never through a shell.
          // @effect-diagnostics-next-line preferSchemaOverJson:off -- bundled Node runtime accepts JSON.
          stdin: input ? JSON.stringify(input) : undefined,
          timeout: "30 seconds",
          maxOutputBytes: 64 * 1024,
        })
        .pipe(
          Effect.mapError(() => new GedMemoryError("Could not run the review policy evaluator.")),
        );
      if (output.code !== 0)
        return yield* fail(output.stderr.trim() || "Could not update review policy.");
      return yield* decodePolicyStatus(output.stdout).pipe(
        Effect.mapError(() => new GedMemoryError("Invalid review policy evaluator response.")),
      );
    });

  const reviewStatus = (root: string) =>
    Effect.gen(function* () {
      const policy = yield* runPolicy(root);
      const gate = yield* gateStatus(root);
      const effective =
        !policy.required && !gate.supportsOptOut
          ? {
              ...policy,
              required: true,
              scope: null,
              reason: null,
              error: "The configured opt-out needs review-policy support in this checkout's gate.",
            }
          : policy;
      return { ...effective, gate: gate.status, gateSupportsOptOut: gate.supportsOptOut };
    });

  const setReviewPolicy = (root: string, input: typeof ReviewPolicyInput.Type) =>
    Effect.gen(function* () {
      yield* realMemoryRoot(root);
      const checked = yield* decodePolicyInput(input).pipe(
        Effect.mapError(() => new GedMemoryError("Explicit scope, mode and reason are required.")),
      );
      if (checked.mode === "skip" && !(yield* gateStatus(root)).supportsOptOut)
        return yield* fail(
          "The installed gate does not support review opt-outs. Upgrade the stock gate or integrate support in the custom gate first.",
        );
      yield* runPolicy(root, checked);
      return yield* reviewStatus(root);
    }).pipe(policyLock.withPermits(1));

  const updateReviewGate = (root: string, apply: boolean) =>
    Effect.gen(function* () {
      const { status } = yield* gateStatus(root);
      if (!apply || status === "current") return { status, applied: false };
      if (status !== "legacy")
        return yield* fail(
          "Only the exact stock legacy gate can be upgraded. Preserve custom gates and integrate the current starter manually.",
        );
      const file = path.join(yield* realMemoryRoot(root), GATE_SCRIPT);
      // Rechecked on apply, not trusted from the caller's preview.
      yield* fs
        .writeFileString(file, LAND_GATE)
        .pipe(Effect.mapError(() => new GedMemoryError("Could not upgrade the review gate.")));
      return { status: "current" as const, applied: true };
    }).pipe(policyLock.withPermits(1));

  const recordRuling = (root: string, ruling: VerdictRuling) =>
    Effect.gen(function* () {
      const slug = verdictSlug(ruling.branch);
      if (slug === undefined)
        return yield* fail(
          `Branch '${ruling.branch}' has no name the land gate can key a verdict to.`,
        );
      const dir = path.join(yield* realMemoryRoot(root), VERDICTS_DIR);
      yield* fs
        .makeDirectory(dir, { recursive: true })
        .pipe(Effect.mapError(() => new GedMemoryError(`Could not open ${MEMORY_DIR}/verdicts.`)));
      if ((yield* resolvesToItself(dir)) !== true)
        return yield* fail(
          `${MEMORY_DIR}/${VERDICTS_DIR} is a symlink; refusing to write through it.`,
        );
      const file = path.join(dir, `${slug}.json`);
      // A write follows a link, a dangling one included, so the record must not be one.
      // The gate refuses a symlinked record too; this stops the write from landing elsewhere.
      if (yield* isSymlink(file))
        return yield* fail(
          `${MEMORY_DIR}/${VERDICTS_DIR}/${slug}.json is a symlink; refusing to write through it.`,
        );
      // A record that is missing or unreadable is started over, like a stale one.
      const existing: unknown = yield* fs.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))),
        Effect.orElseSucceed(() => undefined),
      );
      // The toolkit validated the ruling against its schema before handing it over. The
      // record is written indented rather than through a codec because the gate reads it
      // as a document a human also opens and edits by hand.
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const body = `${JSON.stringify(mergeRuling(existing, ruling), null, 2)}\n`;
      yield* fs
        .writeFileString(file, body)
        .pipe(
          Effect.mapError(() => new GedMemoryError(`Could not write the verdict for ${slug}.`)),
        );
      return `${MEMORY_DIR}/${VERDICTS_DIR}/${slug}.json`;
    }).pipe(verdictLock.withPermits(1));

  /**
   * Runs the gate script rather than reimplementing its rules. One implementation
   * means the answer an agent gets here and the answer a pre-push hook gives are
   * the same answer, and cannot drift apart release by release.
   */
  const landCheck = (root: string) =>
    Effect.gen(function* () {
      const script = path.join(memoryRoot(root), GATE_SCRIPT);
      if (!(yield* fs.exists(script).pipe(Effect.orElseSucceed(() => false))))
        return yield* fail(`This project has no land gate at ${MEMORY_DIR}/${GATE_SCRIPT}.`);
      const output = yield* processes
        .run({
          command: "sh",
          args: [script],
          cwd: root,
          timeout: "30 seconds",
          maxOutputBytes: 64 * 1024,
          outputMode: "truncate",
        })
        .pipe(Effect.mapError(() => new GedMemoryError("The land gate could not be run.")));
      const detail = `${output.stdout}${output.stderr}`.trim();
      if (output.code === 0)
        return { allowed: true, outcome: "allowed", detail } satisfies LandRuling;
      if (output.code === 1)
        return { allowed: false, outcome: "blocked", detail } satisfies LandRuling;
      return { allowed: false, outcome: "error", detail } satisfies LandRuling;
    });

  return {
    present,
    list,
    read,
    recordRuling,
    landCheck,
    reviewStatus,
    setReviewPolicy,
    updateReviewGate,
  } as const;
});

// ProcessRunner is stateless over the spawner, so it is provided here rather than
// threaded through the MCP context, matching TerminalManager and PortScanner.
export const layer = Layer.effect(ProjectMemory, make()).pipe(Layer.provide(ProcessRunner.layer));
