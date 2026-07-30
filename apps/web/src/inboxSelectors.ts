import type { OrchestrationTaskStatus, ThreadInboxLifecycle } from "@t3tools/contracts";

type InboxThread = {
  readonly environmentId?: string;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly inboxLifecycle?: ThreadInboxLifecycle;
  readonly orchestrationOwnership?: unknown;
  readonly archivedAt?: string | null;
  readonly deletedAt?: string | null;
};

type InboxTask = {
  readonly environmentId?: string;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: OrchestrationTaskStatus;
  readonly archivedAt?: string | null;
  readonly deletedAt?: string | null;
};

type ChatRoute = {
  readonly to: "/chat/$environmentId/$threadId";
  readonly params: {
    readonly environmentId: string;
    readonly threadId: string;
  };
};

type OrchestratorRoute = {
  readonly to: "/orch/$environmentId/$projectId";
  readonly params: {
    readonly environmentId: string;
    readonly projectId: string;
  };
};

export type NormalInboxEntry = {
  readonly id: string;
  readonly title: string;
  readonly route: ChatRoute;
};

export type OrchestratorInboxEntry = {
  readonly id: string;
  readonly projectId: string;
  readonly status: OrchestrationTaskStatus;
  readonly route: OrchestratorRoute;
};

const TERMINAL_TASK_STATUSES = new Set<OrchestrationTaskStatus>([
  "landed",
  "no-changes-needed",
  "abandoned",
]);

function normalEntry(thread: InboxThread, environmentId: string): NormalInboxEntry {
  const routeEnvironmentId = thread.environmentId ?? environmentId;
  return {
    id: thread.id,
    title: thread.title,
    route: {
      to: "/chat/$environmentId/$threadId",
      params: { environmentId: routeEnvironmentId, threadId: thread.id },
    },
  };
}

export function selectInboxEntries(input: {
  readonly environmentId: string;
  readonly selectedThreadId: string | null;
  readonly threads: ReadonlyArray<InboxThread>;
  readonly tasks: ReadonlyArray<InboxTask>;
}) {
  const normalThreads = input.threads.filter(
    (thread) =>
      thread.orchestrationOwnership == null &&
      thread.archivedAt == null &&
      thread.deletedAt == null,
  );
  const active: NormalInboxEntry[] = [];
  const snoozed: string[] = [];
  const settled: string[] = [];

  for (const thread of normalThreads) {
    const lifecycle = thread.inboxLifecycle ?? "active";
    if (lifecycle === "active") {
      active.push(normalEntry(thread, input.environmentId));
    } else if (lifecycle === "snoozed") {
      snoozed.push(thread.id);
    } else {
      settled.push(thread.id);
    }
  }

  const selectedThread = normalThreads.find((thread) => thread.id === input.selectedThreadId);
  const selected =
    selectedThread === undefined
      ? null
      : {
          ...normalEntry(selectedThread, input.environmentId),
          shelf: selectedThread.inboxLifecycle ?? "active",
        };

  const orchestrator: OrchestratorInboxEntry[] = input.tasks
    .filter(
      (task) =>
        task.archivedAt == null &&
        task.deletedAt == null &&
        !TERMINAL_TASK_STATUSES.has(task.status),
    )
    .map((task) => ({
      id: task.id,
      projectId: task.projectId,
      status: task.status,
      route: {
        to: "/orch/$environmentId/$projectId",
        params: {
          environmentId: input.environmentId,
          ...(task.environmentId !== undefined ? { environmentId: task.environmentId } : {}),
          projectId: task.projectId,
        },
      },
    }));

  return {
    normal: {
      shelves: { active, snoozed, settled },
      selected,
    },
    orchestrator,
  };
}
