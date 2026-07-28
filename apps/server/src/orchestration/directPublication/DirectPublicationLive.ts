// @effect-diagnostics nodeBuiltinImport:off - validates a trusted server-owned workspace boundary.
import { isAbsolute } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  publishDirectCommitWithServices,
  type DirectPublicationServices,
  type PublishDirectCommitInput,
} from "./DirectPublicationService.ts";
import {
  DirectPublicationError,
  type DirectPublicationInput,
  DirectPublicationPort,
  type DirectPublicationResult,
} from "./DirectPublicationPort.ts";

export interface MakeDirectPublicationPortOptions {
  readonly publish?: (
    services: DirectPublicationServices,
    input: PublishDirectCommitInput,
  ) => Effect.Effect<DirectPublicationResult, DirectPublicationError>;
}

const projectError = (detail: string) =>
  new DirectPublicationError({ reason: "project-invalid", detail });

export const makeDirectPublicationPort = Effect.fn(
  "DirectPublicationLive.makeDirectPublicationPort",
)(function* (options: MakeDirectPublicationPortOptions = {}) {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const vcsProcess = yield* VcsProcess;
  const sourceControlProviders = yield* SourceControlProviderRegistry;
  const publish = options.publish ?? publishDirectCommitWithServices;

  return DirectPublicationPort.of({
    publish: (input: DirectPublicationInput) =>
      Effect.gen(function* () {
        const readModel = yield* snapshotQuery
          .getCommandReadModel()
          .pipe(
            Effect.mapError((cause) =>
              projectError(`Could not load project '${input.projectId}': ${cause}`),
            ),
          );
        const project = readModel.projects.find(
          (candidate) =>
            candidate.id === input.projectId &&
            candidate.deletedAt === null &&
            candidate.orchestratorConfig?.enabled !== false,
        );
        if (project === undefined) {
          return yield* projectError(
            `Project '${input.projectId}' was not found or is not enabled for orchestration.`,
          );
        }
        const workspaceRoot = project.workspaceRoot.trim();
        if (workspaceRoot.length === 0 || !isAbsolute(workspaceRoot)) {
          return yield* projectError(
            `Project '${input.projectId}' does not have a valid absolute workspace root.`,
          );
        }

        const sourceControlProvider = yield* sourceControlProviders
          .resolve({ cwd: workspaceRoot })
          .pipe(
            Effect.mapError(
              (cause) =>
                new DirectPublicationError({
                  reason: "provider-failed",
                  detail: `Could not resolve a source-control provider for '${workspaceRoot}': ${cause}`,
                }),
            ),
          );

        return yield* publish(
          { sourceControlProvider, vcsProcess },
          {
            workspaceRoot,
            projectId: input.projectId,
            sourceCommit: input.sourceCommit,
            destinationBranch: input.destinationBranch,
            baseBranch: input.baseBranch,
            pullRequest: input.pullRequest,
            existingPullRequestUrl: input.existingPullRequestUrl,
          },
        );
      }),
  });
});

export const DirectPublicationPortLive = Layer.effect(
  DirectPublicationPort,
  makeDirectPublicationPort(),
);
