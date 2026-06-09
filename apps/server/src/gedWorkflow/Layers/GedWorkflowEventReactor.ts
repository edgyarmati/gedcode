/**
 * GedWorkflowEventReactor - Reacts to provider runtime events by invalidating
 * Ged workflow verifier checkpoints when file changes are detected.
 *
 * Subscribes to the `ProviderService.streamEvents` stream, filters for
 * `item.completed` events that indicate file modifications, resolves the
 * session CWD via the provider session directory, then reads and updates
 * the checkpoint state in `.ged/runtime/root/checkpoints.json`.
 *
 * Follows the same Layer pattern used by `CheckpointReactor` and
 * `ThreadDeletionReactor`.
 *
 * @module GedWorkflowEventReactor
 */
import type { ProviderRuntimeEvent, ProviderSession, ThreadId } from "@t3tools/contracts";
import { CheckpointState } from "@t3tools/ged-workflow/CheckpointSchema";
import {
  autoEscalateCheckpointState,
  protectCheckpointStateTransition,
} from "@t3tools/ged-workflow/CheckpointValidation";
import { isPathInsideDotDirectory } from "@t3tools/shared/path";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";

const CHECKPOINTS_RELATIVE_PATH = ".ged/runtime/root/checkpoints.json";
const TRUSTED_CHECKPOINTS_RELATIVE_PATH = ".ged/runtime/root/checkpoints.trusted.json";

const decodeCheckpointStateFromJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CheckpointState),
);

const encodeCheckpointStateToJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(CheckpointState),
);

const isFileChangeEvent = (event: ProviderRuntimeEvent): boolean =>
  event.type === "item.completed" && event.payload.itemType === "file_change";

const PATH_KEYS = new Set([
  "path",
  "filePath",
  "file_path",
  "filepath",
  "oldPath",
  "old_path",
  "newPath",
  "new_path",
  "sourcePath",
  "source_path",
  "targetPath",
  "target_path",
]);

const PATH_ARRAY_KEYS = new Set(["paths", "files", "filePaths", "file_paths"]);

const MAX_PATH_EXTRACTION_DEPTH = 6;

type PathExtraction = {
  readonly paths: ReadonlyArray<string>;
  readonly ambiguous: boolean;
};

export type RuntimeFileChangeImpact = {
  readonly shouldInvalidateVerifier: boolean;
  readonly changesCheckpointState: boolean;
  readonly sourcePaths: ReadonlyArray<string>;
  readonly ambiguousSourceEditCount: number;
};

type ThreadSourceEditState = {
  readonly turnId: string | undefined;
  readonly sourcePaths: Set<string>;
  readonly ambiguousSourceEditCount: number;
};

const emptyPathExtraction: PathExtraction = { paths: [], ambiguous: false };

const mergePathExtractions = (left: PathExtraction, right: PathExtraction): PathExtraction => ({
  paths: [...left.paths, ...right.paths],
  ambiguous: left.ambiguous || right.ambiguous,
});

const isPathLikeDetail = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/[\n\r]/.test(trimmed) && !/\s/.test(trimmed);
};

const extractStringPaths = (value: unknown, depth = 0): PathExtraction => {
  if (depth > MAX_PATH_EXTRACTION_DEPTH) return { paths: [], ambiguous: true };
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? { paths: [trimmed], ambiguous: false } : emptyPathExtraction;
  }
  if (Array.isArray(value)) {
    return value.reduce<PathExtraction>((acc, item) => {
      if (typeof item === "string")
        return mergePathExtractions(acc, extractStringPaths(item, depth + 1));
      return { paths: acc.paths, ambiguous: true };
    }, emptyPathExtraction);
  }
  return value == null ? emptyPathExtraction : { paths: [], ambiguous: true };
};

const extractPathCandidatesFromData = (value: unknown, depth = 0): PathExtraction => {
  if (depth > MAX_PATH_EXTRACTION_DEPTH) return { paths: [], ambiguous: true };
  if (value == null || typeof value !== "object") return emptyPathExtraction;
  if (Array.isArray(value)) {
    return value.reduce<PathExtraction>(
      (acc, item) => mergePathExtractions(acc, extractPathCandidatesFromData(item, depth + 1)),
      emptyPathExtraction,
    );
  }

  return Object.entries(value as Record<string, unknown>).reduce<PathExtraction>(
    (acc, [key, item]) => {
      if (PATH_KEYS.has(key) || PATH_ARRAY_KEYS.has(key)) {
        return mergePathExtractions(acc, extractStringPaths(item, depth + 1));
      }
      if (item != null && typeof item === "object") {
        return mergePathExtractions(acc, extractPathCandidatesFromData(item, depth + 1));
      }
      return acc;
    },
    emptyPathExtraction,
  );
};

const extractFileChangePathCandidates = (event: ProviderRuntimeEvent): PathExtraction => {
  const payload = event.payload as { readonly detail?: string; readonly data?: unknown };
  const detail = payload.detail;
  const detailExtraction = detail
    ? isPathLikeDetail(detail)
      ? { paths: [detail.trim()], ambiguous: false }
      : { paths: [], ambiguous: true }
    : emptyPathExtraction;

  return mergePathExtractions(detailExtraction, extractPathCandidatesFromData(payload.data));
};

const isCheckpointStatePath = (changedPath: string): boolean => {
  const normalized = changedPath.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  return (
    normalized === CHECKPOINTS_RELATIVE_PATH || normalized.endsWith(`/${CHECKPOINTS_RELATIVE_PATH}`)
  );
};

export const getRuntimeFileChangeImpact = (
  event: ProviderRuntimeEvent,
): RuntimeFileChangeImpact => {
  if (!isFileChangeEvent(event)) {
    return {
      shouldInvalidateVerifier: false,
      changesCheckpointState: false,
      sourcePaths: [],
      ambiguousSourceEditCount: 0,
    };
  }

  const extraction = extractFileChangePathCandidates(event);
  if (extraction.ambiguous || extraction.paths.length === 0) {
    return {
      shouldInvalidateVerifier: true,
      changesCheckpointState: false,
      sourcePaths: [],
      ambiguousSourceEditCount: 1,
    };
  }

  const changesCheckpointState = extraction.paths.some(isCheckpointStatePath);
  const sourcePaths = extraction.paths.filter(
    (changedPath) => !isPathInsideDotDirectory(changedPath),
  );
  return {
    shouldInvalidateVerifier: sourcePaths.length > 0,
    changesCheckpointState,
    sourcePaths,
    ambiguousSourceEditCount: 0,
  };
};

export const shouldInvalidateVerifierForRuntimeEvent = (event: ProviderRuntimeEvent): boolean =>
  getRuntimeFileChangeImpact(event).shouldInvalidateVerifier;

export const recordRuntimeFileChangeImpact = (
  stateByThread: Map<ThreadId, ThreadSourceEditState>,
  event: ProviderRuntimeEvent,
  impact: RuntimeFileChangeImpact,
): number => {
  const previous = stateByThread.get(event.threadId);
  const eventTurnId = event.turnId;
  const shouldReset = previous && eventTurnId !== undefined && previous.turnId !== eventTurnId;
  const sourcePaths = shouldReset || !previous ? new Set<string>() : new Set(previous.sourcePaths);
  let ambiguousSourceEditCount = shouldReset || !previous ? 0 : previous.ambiguousSourceEditCount;

  for (const sourcePath of impact.sourcePaths) {
    sourcePaths.add(sourcePath);
  }
  ambiguousSourceEditCount += impact.ambiguousSourceEditCount;

  stateByThread.set(event.threadId, {
    turnId: eventTurnId ?? previous?.turnId,
    sourcePaths,
    ambiguousSourceEditCount,
  });

  return sourcePaths.size + ambiguousSourceEditCount;
};

const resolveSessionCwd = (
  threadId: ThreadId,
  listSessions: ProviderServiceShape["listSessions"],
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const sessions: ReadonlyArray<ProviderSession> = yield* listSessions();
    const session = sessions.find((s) => s.threadId === threadId);
    return session?.cwd;
  });

const readCheckpointStateIfExists = (fs: FileSystem.FileSystem, checkpointsPath: string) =>
  Effect.gen(function* () {
    if (!(yield* fs.exists(checkpointsPath))) return undefined;
    const raw = yield* fs.readFileString(checkpointsPath);
    return yield* decodeCheckpointStateFromJson(raw);
  });

export const GedWorkflowEventReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceEditStateByThread = new Map<ThreadId, ThreadSourceEditState>();

    const handleFileChangeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> => {
      const impact = getRuntimeFileChangeImpact(event);
      const sourceEditCount = recordRuntimeFileChangeImpact(sourceEditStateByThread, event, impact);

      if (!impact.shouldInvalidateVerifier && !impact.changesCheckpointState) return Effect.void;

      return Effect.gen(function* () {
        const cwd = yield* resolveSessionCwd(event.threadId, providerService.listSessions);
        if (!cwd) return;

        const checkpointsPath = path.join(cwd, CHECKPOINTS_RELATIVE_PATH);
        const trustedCheckpointsPath = path.join(cwd, TRUSTED_CHECKPOINTS_RELATIVE_PATH);
        const exists = yield* fs.exists(checkpointsPath);
        if (!exists) return;

        const raw = yield* fs.readFileString(checkpointsPath);
        let cpState = yield* decodeCheckpointStateFromJson(raw);

        if (impact.changesCheckpointState) {
          const trustedState = yield* readCheckpointStateIfExists(fs, trustedCheckpointsPath);
          cpState = protectCheckpointStateTransition(trustedState, cpState);
          const protectedEncoded = yield* encodeCheckpointStateToJson(cpState);
          yield* fs.writeFileString(checkpointsPath, protectedEncoded);
          yield* fs.writeFileString(trustedCheckpointsPath, protectedEncoded);
          if (!impact.shouldInvalidateVerifier) return;
        }

        const updated =
          cpState.lifecycleStatus === "closed"
            ? cpState
            : autoEscalateCheckpointState(cpState, sourceEditCount);
        const encoded = yield* encodeCheckpointStateToJson(updated);
        yield* fs.writeFileString(checkpointsPath, encoded);
        yield* fs.writeFileString(trustedCheckpointsPath, encoded);
      }).pipe(
        Effect.catch(() =>
          Effect.logDebug("ged-workflow event reactor skipped file change invalidation", {
            threadId: event.threadId,
          }),
        ),
      );
    };

    yield* providerService.streamEvents.pipe(
      Stream.filter(isFileChangeEvent),
      Stream.runForEach(handleFileChangeEvent),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("ged-workflow event reactor stream failed", {
          cause: Cause.pretty(cause),
        });
      }),
      Effect.forkScoped,
    );
  }),
);
