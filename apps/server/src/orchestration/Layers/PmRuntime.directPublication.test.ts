import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import type { DirectPublicationPortShape } from "../directPublication/DirectPublicationPort.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { createEmptyReadModel } from "../projector.ts";
import { makePmRuntimeMcpToolExecutors } from "./PmRuntime.ts";

it.effect("constructs PM MCP executors with the live direct-publication port", () =>
  Effect.gen(function* () {
    const calls: Array<Parameters<DirectPublicationPortShape["publish"]>[0]> = [];
    const executors = yield* makePmRuntimeMcpToolExecutors({
      directPublication: {
        publish: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return {
              pullRequestUrl: "https://github.com/acme/project/pull/42",
              sourceCommit: input.sourceCommit,
              destinationBranch: input.destinationBranch,
            };
          }),
      },
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeCrypto.layer,
          Layer.mock(OrchestrationEngineService)({
            readEvents: () => Stream.empty,
            streamDomainEvents: Stream.empty,
            streamShellEvents: Stream.empty,
          }),
          Layer.mock(ProjectionPendingApprovalRepository)({}),
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () =>
              Effect.succeed({
                ...createEmptyReadModel("2026-07-28T00:00:00.000Z"),
                projects: [
                  {
                    id: ProjectId.make("project-1"),
                    title: "Project",
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
                  },
                ],
              }),
          }),
        ),
      ),
    );
    const publish = executors.find((executor) => executor.name === "publishDirectCommit");
    assert.ok(publish);

    const result = yield* Effect.promise(() =>
      publish.execute("runtime-direct-publish", {
        projectId: ProjectId.make("project-1"),
        sourceCommit: "a".repeat(40),
        destinationBranch: "ged/direct/runtime",
        baseBranch: "main",
        pullRequest: { title: "Publish runtime commit", body: "One reviewed commit." },
      }),
    );

    assert.deepEqual(calls, [
      {
        projectId: ProjectId.make("project-1"),
        sourceCommit: "a".repeat(40),
        destinationBranch: "ged/direct/runtime",
        baseBranch: "main",
        pullRequest: { title: "Publish runtime commit", body: "One reviewed commit." },
        existingPullRequestUrl: null,
      },
    ]);
    assert.deepEqual(result.details, {
      pullRequestUrl: "https://github.com/acme/project/pull/42",
      sourceCommit: "a".repeat(40),
      destinationBranch: "ged/direct/runtime",
    });
  }),
);
