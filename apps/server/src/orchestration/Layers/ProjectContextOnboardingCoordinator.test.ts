import {
  ProjectContextFingerprint,
  ProjectContextRunId,
  ProjectId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { makeProjectContextSnapshot } from "../../project/ProjectContext.ts";
import { ProjectContextScanner } from "../../project/Services/ProjectContextScanner.ts";
import { createEmptyReadModel } from "../projector.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import {
  makeProjectContextOnboardingCoordinator,
  ProjectContextOnboardingCoordinatorError,
} from "./ProjectContextOnboardingCoordinator.ts";

const projectId = ProjectId.make("project-context-onboarding");
const createdAt = "2026-07-20T10:00:00.000Z";
const fingerprint = ProjectContextFingerprint.make(`sha256:${"a".repeat(64)}`);

const snapshot = makeProjectContextSnapshot({
  files: [
    {
      relativePath: "AGENTS.md",
      classification: "substantive",
      normalizedContent: "# Rules",
    },
    {
      relativePath: ".ged/PROJECT.md",
      classification: "missing",
      normalizedContent: "",
    },
  ],
});

const readModel = (input?: {
  readonly activeRun?: boolean;
  readonly resolution?: OrchestrationReadModel["projects"][number]["projectContextResolution"];
}): OrchestrationReadModel => ({
  ...createEmptyReadModel(createdAt),
  projects: [
    {
      id: projectId,
      workspaceRoot: "/tmp/project-context-onboarding",
      deletedAt: null,
      projectContextResolution: input?.resolution ?? null,
    } as OrchestrationReadModel["projects"][number],
  ],
  projectContextRuns: input?.activeRun
    ? [
        {
          id: ProjectContextRunId.make("project-context-run-active"),
          projectId,
          schemaVersion: snapshot.schemaVersion,
          fingerprint: snapshot.fingerprint,
          status: "pending-review",
        } as OrchestrationReadModel["projectContextRuns"][number],
      ]
    : [],
});

const queryLayer = (model: OrchestrationReadModel) =>
  Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.succeed(model),
  } as unknown as ProjectionSnapshotQueryShape);

const scannerLayer = (nextSnapshot = snapshot) =>
  Layer.succeed(ProjectContextScanner, {
    scan: () => Effect.succeed(nextSnapshot),
  });

const engineLayer = (dispatched: OrchestrationCommand[]) =>
  Layer.succeed(OrchestrationEngineService, {
    readEvents: () => Stream.empty,
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: 23 };
      }),
    streamDomainEvents: Stream.empty,
    streamShellEvents: Stream.empty,
  } satisfies OrchestrationEngineShape);

const makeCoordinator = (input: {
  readonly model: OrchestrationReadModel;
  readonly dispatched?: OrchestrationCommand[];
  readonly nextSnapshot?: typeof snapshot;
}) =>
  makeProjectContextOnboardingCoordinator.pipe(
    Effect.provide(
      Layer.mergeAll(
        queryLayer(input.model),
        scannerLayer(input.nextSnapshot),
        engineLayer(input.dispatched ?? []),
      ),
    ),
  );

it.layer(NodeServices.layer)("ProjectContextOnboardingCoordinator", (it) => {
  describe("get", () => {
    it.effect(
      "returns a content-free prompt presentation and suppresses a matching active run",
      () =>
        Effect.gen(function* () {
          const coordinator = yield* makeCoordinator({
            model: readModel({ activeRun: true }),
          });
          const result = yield* coordinator.get({ projectId });

          expect(result).toEqual({
            projectId,
            schemaVersion: snapshot.schemaVersion,
            fingerprint: snapshot.fingerprint,
            promptKind: "review",
            files: [
              { path: "AGENTS.md", classification: "substantive" },
              { path: ".ged/PROJECT.md", classification: "missing" },
            ],
            shouldPrompt: false,
          });
        }),
    );
  });

  describe("dismiss", () => {
    it.effect("rejects stale scanner values before dispatching a resolution", () =>
      Effect.gen(function* () {
        const dispatched: OrchestrationCommand[] = [];
        const coordinator = yield* makeCoordinator({
          model: readModel(),
          dispatched,
        });
        const error = yield* coordinator
          .dismiss({
            projectId,
            schemaVersion: snapshot.schemaVersion,
            fingerprint,
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(ProjectContextOnboardingCoordinatorError);
        expect(error).toMatchObject({ reason: "stale-context" });
        expect(dispatched).toEqual([]);
      }),
    );

    it.effect("dispatches dismissal only after the expected scan still matches", () =>
      Effect.gen(function* () {
        const dispatched: OrchestrationCommand[] = [];
        const coordinator = yield* makeCoordinator({
          model: readModel(),
          dispatched,
        });
        const result = yield* coordinator.dismiss({
          projectId,
          schemaVersion: snapshot.schemaVersion,
          fingerprint: snapshot.fingerprint,
        });

        expect(result).toEqual({ sequence: 23 });
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]).toMatchObject({
          type: "project.context.resolve",
          projectId,
          schemaVersion: snapshot.schemaVersion,
          fingerprint: snapshot.fingerprint,
          outcome: "dismissed",
        });
      }),
    );
  });
});
