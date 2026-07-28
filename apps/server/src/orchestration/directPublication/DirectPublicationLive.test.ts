import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import type { SourceControlProviderShape } from "../../sourceControl/SourceControlProvider.ts";
import type { VcsProcessShape } from "../../vcs/VcsProcess.ts";
import { createEmptyReadModel } from "../projector.ts";
import { makeDirectPublicationPort } from "./DirectPublicationLive.ts";

const projectOneId = ProjectId.make("project-one");
const projectTwoId = ProjectId.make("project-two");

const unusedProvider = (): SourceControlProviderShape => ({
  kind: "github",
  listChangeRequests: () => Effect.die("not used"),
  getChangeRequest: () => Effect.die("not used"),
  createChangeRequest: () => Effect.die("not used"),
  updateChangeRequest: () => Effect.die("not used"),
  getRepositoryCloneUrls: () => Effect.die("not used"),
  createRepository: () => Effect.die("not used"),
  getDefaultBranch: () => Effect.die("not used"),
  checkoutChangeRequest: () => Effect.die("not used"),
});

it.effect(
  "binds direct publication to the explicitly selected project workspace and source-control provider",
  () =>
    Effect.gen(function* () {
      const projectOne = {
        id: projectOneId,
        title: "Project one",
        workspaceRoot: "/projects/one",
        repositoryIdentity: null,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        roleModelSelections: {},
        orchestratorConfig: {},
        scripts: [],
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z",
        deletedAt: null,
      };
      const projectTwo = {
        ...projectOne,
        id: projectTwoId,
        title: "Project two",
        workspaceRoot: "/projects/two",
      };
      const sourceControlProvider = unusedProvider();
      const vcsProcess: VcsProcessShape = { run: () => Effect.die("not used") };
      const calls: unknown[] = [];

      const port = yield* makeDirectPublicationPort({
        publish: (services, input) =>
          Effect.sync(() => {
            calls.push({ services, input });
            return {
              pullRequestUrl: "https://github.com/acme/project/pull/42",
              sourceCommit: input.sourceCommit,
              destinationBranch: input.destinationBranch,
            };
          }),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionSnapshotQuery)({
              getCommandReadModel: () =>
                Effect.succeed({
                  ...createEmptyReadModel("2026-07-28T00:00:00.000Z"),
                  projects: [projectOne, projectTwo],
                }),
            }),
            Layer.mock(SourceControlProviderRegistry)({
              resolve: ({ cwd }) => {
                assert.equal(cwd, projectOne.workspaceRoot);
                return Effect.succeed(sourceControlProvider);
              },
            }),
            Layer.succeed(VcsProcess, vcsProcess),
          ),
        ),
      );

      const result = yield* port.publish({
        projectId: projectOneId,
        sourceCommit: "a".repeat(40),
        destinationBranch: "ged/direct/project-one",
        baseBranch: "main",
        pullRequest: { title: "Publish project one", body: "Route one reviewed commit." },
        existingPullRequestUrl: null,
      });

      assert.deepEqual(result, {
        pullRequestUrl: "https://github.com/acme/project/pull/42",
        sourceCommit: "a".repeat(40),
        destinationBranch: "ged/direct/project-one",
      });
      assert.deepEqual(calls, [
        {
          services: { sourceControlProvider, vcsProcess },
          input: {
            workspaceRoot: projectOne.workspaceRoot,
            projectId: projectOneId,
            sourceCommit: "a".repeat(40),
            destinationBranch: "ged/direct/project-one",
            baseBranch: "main",
            pullRequest: { title: "Publish project one", body: "Route one reviewed commit." },
            existingPullRequestUrl: null,
          },
        },
      ]);
    }),
);
