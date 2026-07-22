import type { ChangeRequest, OrchestrationReadModel, ProjectId, TaskId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * A persisted PR URL is the durable tracking registration. It survives a
 * process restart without an in-memory scheduler registry and is intentionally
 * independent of the source-control provider used to query it.
 */
export interface TrackedPullRequest {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly reference: string;
}

export type TrackedPullRequestSyncResult =
  | { readonly tracked: TrackedPullRequest; readonly state: "open" | "closed" }
  | {
      readonly tracked: TrackedPullRequest;
      readonly state: "merged";
      readonly changeRequest: ChangeRequest;
    };

/**
 * Select only tasks whose durable projection says their PR is still open. The
 * projection is the restart-safe registration boundary: a merged or closed
 * observation immediately removes the task from subsequent polling.
 */
export const listTrackedPullRequests = (
  readModel: OrchestrationReadModel,
): ReadonlyArray<TrackedPullRequest> => {
  const projectById = new Map(readModel.projects.map((project) => [String(project.id), project]));
  return readModel.tasks.flatMap((task) => {
    if (task.status !== "pr-open" || task.prUrl === null) {
      return [];
    }
    const project = projectById.get(String(task.projectId));
    return project === undefined
      ? []
      : [
          {
            taskId: task.id,
            projectId: task.projectId,
            // Query from the primary checkout. Task worktrees can be released
            // independently of remote PR tracking, while the project checkout
            // retains the authoritative source-control remote.
            cwd: project.workspaceRoot,
            reference: task.prUrl,
          },
        ];
  });
};

export const synchronizeTrackedPullRequests = Effect.fn("synchronizeTrackedPullRequests")(
  function* <E>(input: {
    readonly tracked: ReadonlyArray<TrackedPullRequest>;
    readonly getChangeRequest: (tracked: TrackedPullRequest) => Effect.Effect<ChangeRequest, E>;
  }) {
    return yield* Effect.forEach(input.tracked, (tracked) =>
      input
        .getChangeRequest(tracked)
        .pipe(
          Effect.map((changeRequest) =>
            changeRequest.state === "merged"
              ? ({ tracked, state: "merged", changeRequest } as const)
              : ({ tracked, state: changeRequest.state } as const),
          ),
        ),
    );
  },
);
