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
import { invalidateVerifierCheckpoints } from "@t3tools/ged-workflow/CheckpointValidation";
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

const decodeCheckpointStateFromJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CheckpointState),
);

const encodeCheckpointStateToJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(CheckpointState),
);

const isFileChangeEvent = (event: ProviderRuntimeEvent): boolean =>
  event.type === "item.completed" && event.payload.itemType === "file_change";

const resolveSessionCwd = (
  threadId: ThreadId,
  listSessions: ProviderServiceShape["listSessions"],
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const sessions: ReadonlyArray<ProviderSession> = yield* listSessions();
    const session = sessions.find((s) => s.threadId === threadId);
    return session?.cwd;
  });

export const GedWorkflowEventReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const handleFileChangeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        const cwd = yield* resolveSessionCwd(event.threadId, providerService.listSessions);
        if (!cwd) return;

        const checkpointsPath = path.join(cwd, CHECKPOINTS_RELATIVE_PATH);
        const exists = yield* fs.exists(checkpointsPath);
        if (!exists) return;

        const raw = yield* fs.readFileString(checkpointsPath);
        const cpState = yield* decodeCheckpointStateFromJson(raw);
        const updated = invalidateVerifierCheckpoints(cpState);
        const encoded = yield* encodeCheckpointStateToJson(updated);
        yield* fs.writeFileString(checkpointsPath, encoded);
      }).pipe(
        Effect.catch(() =>
          Effect.logDebug("ged-workflow event reactor skipped file change invalidation", {
            threadId: event.threadId,
          }),
        ),
      );

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
