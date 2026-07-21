import { ProjectContextRunId, ProjectId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ensureGedManifestBeforePmTurnWithServices } from "./gedManifestMaintenance.ts";

const projectId = ProjectId.make("manifest-maintenance");
const readModel = (projectContextRuns: ReadonlyArray<unknown> = []) =>
  Effect.succeed({
    projects: [{ id: projectId, workspaceRoot: "/repo", deletedAt: null }],
    projectContextRuns,
  } as never);

it.effect("adopts legacy manifests and starts missing maintenance exactly once", () =>
  Effect.gen(function* () {
    const adoptions: unknown[] = [];
    const requests: unknown[] = [];
    const base = {
      readModel: readModel(),
      now: Effect.succeed("2026-07-21T12:00:00.000Z"),
      generatedBy: Effect.succeed("gedcode@0.3.0"),
      request: (requested: ProjectId) =>
        Effect.sync(() => {
          requests.push(requested);
          return { projectContextRunId: ProjectContextRunId.make("run-1") };
        }),
    };

    expect(
      yield* ensureGedManifestBeforePmTurnWithServices(
        {
          ...base,
          manifests: {
            inspect: () => Effect.succeed({ status: "legacy", sourceSchemaVersion: 2 }),
            adoptLegacy: (input) =>
              Effect.sync(() => {
                adoptions.push(input);
                return {
                  status: "current" as const,
                  sourceSchemaVersion: 3,
                  manifest: {
                    schemaVersion: 3,
                    updatedAt: input.now,
                    lastReviewedAt: input.now,
                    generatedBy: input.generatedBy,
                  },
                };
              }),
          },
        },
        projectId,
      ),
    ).toEqual({ status: "ready" });
    expect(adoptions).toHaveLength(1);

    expect(
      yield* ensureGedManifestBeforePmTurnWithServices(
        {
          ...base,
          manifests: {
            inspect: () => Effect.succeed({ status: "missing", sourceSchemaVersion: 0 }),
            adoptLegacy: () => Effect.die("not used"),
          },
        },
        projectId,
      ),
    ).toEqual({ status: "maintenance-started", projectContextRunId: "run-1" });
    expect(requests).toEqual([projectId]);
  }),
);

it.effect("keeps active maintenance stable and refuses newer schemas", () =>
  Effect.gen(function* () {
    const activeId = ProjectContextRunId.make("active-run");
    const base = {
      now: Effect.succeed("2026-07-21T12:00:00.000Z"),
      generatedBy: Effect.succeed("gedcode@0.3.0"),
      request: () => Effect.die("not used"),
      manifests: {
        inspect: () => Effect.die("not used"),
        adoptLegacy: () => Effect.die("not used"),
      },
    };
    expect(
      yield* ensureGedManifestBeforePmTurnWithServices(
        {
          ...base,
          readModel: readModel([{ id: activeId, projectId, status: "running" }]),
        },
        projectId,
      ),
    ).toEqual({ status: "maintenance-active", projectContextRunId: activeId });

    const newer = ensureGedManifestBeforePmTurnWithServices(
      {
        ...base,
        readModel: readModel(),
        manifests: {
          inspect: () =>
            Effect.succeed({
              status: "newer",
              sourceSchemaVersion: 4,
              manifest: {
                schemaVersion: 4,
                updatedAt: "2026-07-21T12:00:00.000Z",
                lastReviewedAt: "2026-07-21T12:00:00.000Z",
                generatedBy: "gedcode@9.0.0",
              },
            }),
          adoptLegacy: () => Effect.die("not used"),
        },
      },
      projectId,
    );
    expect((yield* newer.pipe(Effect.flip)).detail).toMatch(/newer GedCode/);
  }),
);
