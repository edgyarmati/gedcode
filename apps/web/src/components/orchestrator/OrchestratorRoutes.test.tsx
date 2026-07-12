import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalRequestId,
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationGateKind,
} from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { useStore } from "../../store";
import type { OrchestratorTask, Project, Thread } from "../../types";
import { SidebarProvider } from "../ui/sidebar";
import { OrchestratorSidebarNav } from "./OrchestratorSidebarNav";
import { confirmAndCancelTask, confirmAndClearPmChat } from "./OrchestratorRoutes.logic";
import {
  AbandonedTaskBoardSection,
  activeStageLabel,
  formatElapsed,
  needsYouReason,
  needsYouReasonLabel,
  partitionBoardTasks,
  TaskBoard,
  terminalTaskContextMenuItems,
  type BoardTaskEntry,
} from "./TaskBoard";
import {
  buildPmModelSelectionUpdateCommand,
  buildPmUserInputRespondCommand,
  decidePmHarnessSwitchGate,
  PmChatComposer,
  runPmHarnessSwitchAction,
} from "./PmChatComposer";
import { TaskPrLink } from "./TaskPrLink";
import { OrchestratorHomeRoute, PmChatEmptyState } from "./OrchestratorRoutes";

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
  params?: Record<string, string>;
  to?: string;
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params: _params, to, ...props }: MockLinkProps) => (
    <a href={to ?? "#"} {...props}>
      {children}
    </a>
  ),
  useParams: () => null,
}));

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const boardEnvironmentId = EnvironmentId.make("environment-board");
const boardProjectId = ProjectId.make("project-board");

function makeBoardTask(
  id: string,
  status: OrchestratorTask["status"],
  title: string,
): OrchestratorTask {
  return {
    id: TaskId.make(id),
    environmentId: boardEnvironmentId,
    projectId: boardProjectId,
    type: TaskTypeId.make("feature"),
    title,
    status,
    branch: null,
    worktreePath: null,
    prUrl: null,
    pmMessageId: null,
    stageThreadIds: [],
    currentStageThreadId: null,
    cancellation: null,
    landing: null,
    roleModelSelections: {},
    playbookVersion: null,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
  };
}

describe("TaskBoard", () => {
  it("offers status-sensitive terminal task retention menus", () => {
    expect(terminalTaskContextMenuItems(false)).toEqual([
      { id: "copy-task-id", label: "Copy task ID" },
      { id: "archive-task", label: "Archive task" },
      { id: "delete-task", label: "Delete task permanently", destructive: true },
    ]);
    expect(terminalTaskContextMenuItems(true)).toEqual([
      { id: "copy-task-id", label: "Copy task ID" },
      { id: "restore-task", label: "Restore task" },
      { id: "delete-task", label: "Delete task permanently", destructive: true },
    ]);
  });

  it("excludes abandoned tasks from the header badge count", () => {
    const markup = renderToStaticMarkup(
      <TaskBoard
        environmentId={boardEnvironmentId}
        projectId={boardProjectId}
        tasks={[
          makeBoardTask("task-draft", "draft", "Visible draft task"),
          makeBoardTask("task-working", "working", "Visible working task"),
          makeBoardTask("task-verifying", "verifying", "Visible verifying task"),
          makeBoardTask("task-abandoned", "abandoned", "Cancelled task"),
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Board task count">3</span>');
    expect(markup).toContain("Visible draft task");
    expect(markup).toContain("Visible working task");
    expect(markup).toContain("Visible verifying task");
    expect(markup).not.toContain("Cancelled task");
  });

  it("renders verifying tasks in their board section", () => {
    const markup = renderToStaticMarkup(
      <TaskBoard
        environmentId={boardEnvironmentId}
        projectId={boardProjectId}
        tasks={[makeBoardTask("task-verifying", "verifying", "Verify stage task")]}
      />,
    );

    expect(markup).toContain("Verifying");
    expect(markup).toContain("Verify stage task");
    expect(markup).toContain('aria-label="Board task count">1</span>');
  });

  it("renders abandoned tasks collapsed with a count and expanded with task cards", () => {
    const tasks = [
      makeBoardTask("task-abandoned-1", "abandoned", "Cancelled task one"),
      makeBoardTask("task-abandoned-2", "abandoned", "Cancelled task two"),
    ];
    const collapsedMarkup = renderToStaticMarkup(
      <AbandonedTaskBoardSection
        environmentId={boardEnvironmentId}
        expanded={false}
        onExpandedChange={() => {}}
        projectId={boardProjectId}
        tasks={tasks}
      />,
    );
    const expandedMarkup = renderToStaticMarkup(
      <AbandonedTaskBoardSection
        environmentId={boardEnvironmentId}
        expanded={true}
        onExpandedChange={() => {}}
        projectId={boardProjectId}
        tasks={tasks}
      />,
    );

    expect(collapsedMarkup).toContain("Abandoned");
    expect(collapsedMarkup).toContain('aria-expanded="false"');
    expect(collapsedMarkup).toMatch(/aria-label="Abandoned task count"[^>]*>2<\/span>/);
    expect(collapsedMarkup).not.toContain("Cancelled task one");
    expect(collapsedMarkup).not.toContain("Cancelled task two");

    expect(expandedMarkup).toContain('aria-expanded="true"');
    expect(expandedMarkup).toContain("Cancelled task one");
    expect(expandedMarkup).toContain("Cancelled task two");
  });

  it("omits the abandoned section when there are no abandoned tasks", () => {
    const markup = renderToStaticMarkup(
      <TaskBoard
        environmentId={boardEnvironmentId}
        projectId={boardProjectId}
        tasks={[makeBoardTask("task-working", "working", "Visible working task")]}
      />,
    );

    expect(markup).not.toContain("Abandoned");
    expect(markup).not.toContain("Abandoned task count");
  });

  it("surfaces a blocked task in the Needs you section, not in Active", () => {
    const markup = renderToStaticMarkup(
      <TaskBoard
        environmentId={boardEnvironmentId}
        projectId={boardProjectId}
        tasks={[
          makeBoardTask("task-blocked", "blocked", "Blocked task"),
          makeBoardTask("task-working", "working", "Working task"),
        ]}
      />,
    );

    expect(markup).toContain("Needs you");
    expect(markup).toContain("Blocked task");
    expect(markup).toContain(">Blocked</span>");
    expect(markup).toContain("Active");
    expect(markup).toContain("Working task");
    // Header badge counts needs-you (1) + active (1).
    expect(markup).toContain('aria-label="Board task count">2</span>');
  });

  it("omits the Needs you section when nothing needs the human", () => {
    const markup = renderToStaticMarkup(
      <TaskBoard
        environmentId={boardEnvironmentId}
        projectId={boardProjectId}
        tasks={[makeBoardTask("task-working", "working", "Working task")]}
      />,
    );

    expect(markup).not.toContain("Needs you");
  });

  it("renders a draft task as Starting… in the Active section", () => {
    const markup = renderToStaticMarkup(
      <TaskBoard
        environmentId={boardEnvironmentId}
        projectId={boardProjectId}
        tasks={[makeBoardTask("task-draft", "draft", "Fresh draft task")]}
      />,
    );

    expect(markup).toContain("Starting…");
    expect(markup).toContain("Fresh draft task");
  });

  it("renders landed tasks collapsed with a count and excludes them from the header badge", () => {
    const markup = renderToStaticMarkup(
      <TaskBoard
        environmentId={boardEnvironmentId}
        projectId={boardProjectId}
        tasks={[
          makeBoardTask("task-working", "working", "Working task"),
          makeBoardTask("task-landed-1", "landed", "Landed task one"),
          makeBoardTask("task-landed-2", "landed", "Landed task two"),
        ]}
      />,
    );

    expect(markup).toContain("Landed");
    expect(markup).toMatch(/aria-label="Landed task count"[^>]*>2<\/span>/);
    // Collapsed by default: landed task titles are not rendered.
    expect(markup).not.toContain("Landed task one");
    expect(markup).not.toContain("Landed task two");
    // Header badge counts only needs-you + active (the single working task).
    expect(markup).toContain('aria-label="Board task count">1</span>');
  });
});

describe("TaskBoard bucketing helpers", () => {
  function entry(
    status: OrchestratorTask["status"],
    gates: readonly OrchestrationGateKind[] = [],
  ): BoardTaskEntry {
    return {
      task: makeBoardTask(`task-${status}-${gates.join("-")}`, status, "title"),
      pendingGateKinds: gates,
    };
  }

  it("routes tasks with a pending gate or blocked status into Needs you", () => {
    const partition = partitionBoardTasks([
      entry("planning", ["plan"]),
      entry("working"),
      entry("blocked"),
      entry("blocked-on-quota"),
      entry("landed"),
      entry("abandoned"),
    ]);

    expect(partition.needsYou.map(({ reason }) => reason)).toEqual([
      { kind: "gate", gate: "plan" },
      { kind: "blocked" },
      { kind: "quota" },
    ]);
    expect(partition.active).toHaveLength(1);
    expect(partition.active[0]?.status).toBe("working");
    expect(partition.landed).toHaveLength(1);
    expect(partition.abandoned).toHaveLength(1);
  });

  it("prefers a pending gate reason over a blocked status", () => {
    expect(needsYouReason(entry("blocked", ["land"]))).toEqual({ kind: "gate", gate: "land" });
  });

  it("keeps PR opening active and routes durable landing failure into Needs you", () => {
    const opening = entry("landed");
    const failed = entry("landed");
    const partition = partitionBoardTasks([
      {
        ...opening,
        task: {
          ...opening.task,
          landing: {
            status: "opening-pr",
            failureMessage: null,
            branchPushed: false,
            updatedAt: opening.task.updatedAt,
          },
        },
      },
      {
        ...failed,
        task: {
          ...failed.task,
          landing: {
            status: "failed",
            failureMessage: "provider unavailable",
            branchPushed: true,
            updatedAt: failed.task.updatedAt,
          },
        },
      },
    ]);

    expect(partition.active).toHaveLength(1);
    expect(partition.needsYou.map(({ reason }) => reason)).toEqual([{ kind: "landing-failed" }]);
    expect(partition.landed).toHaveLength(0);
  });

  it("labels needs-you reasons", () => {
    expect(needsYouReasonLabel({ kind: "gate", gate: "plan" })).toBe("Awaiting plan approval");
    expect(needsYouReasonLabel({ kind: "gate", gate: "land" })).toBe("Awaiting land approval");
    expect(needsYouReasonLabel({ kind: "blocked" })).toBe("Blocked");
    expect(needsYouReasonLabel({ kind: "quota" })).toBe("Quota");
    expect(needsYouReasonLabel({ kind: "landing-failed" })).toBe("Landing failed");
  });

  it("maps active statuses to stage-role labels", () => {
    expect(activeStageLabel("draft")).toBe("Starting…");
    expect(activeStageLabel("classified")).toBe("Starting…");
    expect(activeStageLabel("planning")).toBe("Planning");
    expect(activeStageLabel("plan-review")).toBe("Plan review");
    expect(activeStageLabel("reviewing")).toBe("Reviewing");
    expect(activeStageLabel("working")).toBe("Working");
    expect(activeStageLabel("review")).toBe("Review");
    expect(activeStageLabel("verifying")).toBe("Verifying");
  });

  it("formats elapsed time coarsely", () => {
    const start = "2026-06-14T00:00:00.000Z";
    expect(formatElapsed(start, Date.parse("2026-06-14T00:00:42.000Z"))).toBe("42s");
    expect(formatElapsed(start, Date.parse("2026-06-14T00:03:05.000Z"))).toBe("3m 5s");
    expect(formatElapsed(start, Date.parse("2026-06-14T02:07:00.000Z"))).toBe("2h 7m");
    expect(formatElapsed("not-a-date", Date.now())).toBeNull();
  });
});

describe("PmChatEmptyState", () => {
  it("explains the PM's purpose and points to the task board", () => {
    const markup = renderToStaticMarkup(<PmChatEmptyState />);

    expect(markup).toContain("Tell the project manager what you want built.");
    expect(markup).toContain("board to the right");
  });
});

describe("Orchestrator add-project affordances", () => {
  it("renders a New project control in the landing header", () => {
    useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });

    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <OrchestratorHomeRoute />
      </SidebarProvider>,
    );

    expect(markup).toContain("New project");
  });

  it("renders an Add project control in the orchestrator sidebar nav", () => {
    useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });

    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <OrchestratorSidebarNav />
      </SidebarProvider>,
    );

    expect(markup).toContain('aria-label="Add project"');
  });
});

describe("TaskPrLink", () => {
  it("renders a clickable PR link when a task has a PR URL", () => {
    const markup = renderToStaticMarkup(
      <TaskPrLink prUrl="https://github.com/acme/project/pull/42" />,
    );

    expect(markup).toContain("View PR");
    expect(markup).toContain('href="https://github.com/acme/project/pull/42"');
    expect(markup).toContain('target="_blank"');
  });

  it("confirms before dispatching Clear PM chat", async () => {
    const projectId = ProjectId.make("project-1");
    const confirm = vi.fn(async () => true);
    const clearPmChat = vi.fn(async () => ({ sequence: 1 }));

    await expect(
      confirmAndClearPmChat({
        projectId,
        confirm,
        clearPmChat,
      }),
    ).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledOnce();
    expect(clearPmChat).toHaveBeenCalledWith({ projectId });
  });

  it("does not dispatch Clear PM chat when confirmation is cancelled", async () => {
    const projectId = ProjectId.make("project-1");
    const confirm = vi.fn(async () => false);
    const clearPmChat = vi.fn(async () => ({ sequence: 1 }));

    await expect(
      confirmAndClearPmChat({
        projectId,
        confirm,
        clearPmChat,
      }),
    ).resolves.toBe(false);

    expect(confirm).toHaveBeenCalledOnce();
    expect(clearPmChat).not.toHaveBeenCalled();
  });

  it("confirms before dispatching Cancel task", async () => {
    const taskId = TaskId.make("task-1");
    const confirm = vi.fn(async () => true);
    const cancelTask = vi.fn(async () => ({ sequence: 1 }));

    await expect(confirmAndCancelTask({ taskId, confirm, cancelTask })).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledOnce();
    expect(cancelTask).toHaveBeenCalledWith({ taskId });
  });

  it("does not dispatch Cancel task when confirmation is cancelled", async () => {
    const taskId = TaskId.make("task-1");
    const confirm = vi.fn(async () => false);
    const cancelTask = vi.fn(async () => ({ sequence: 1 }));

    await expect(confirmAndCancelTask({ taskId, confirm, cancelTask })).resolves.toBe(false);

    expect(confirm).toHaveBeenCalledOnce();
    expect(cancelTask).not.toHaveBeenCalled();
  });
});

describe("PmChatComposer", () => {
  const environmentId = EnvironmentId.make("environment-local");
  const projectId = ProjectId.make("project-1");
  const pmThreadId = ThreadId.make("pm:project-1");
  const project = {
    id: projectId,
    environmentId,
    name: "Project",
    cwd: "/tmp/project",
    repositoryIdentity: null,
    defaultModelSelection: null,
    orchestratorConfig: {
      enabled: true,
      pmModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
    },
    scripts: [],
  } satisfies Project;

  const pmThread = {
    id: pmThreadId,
    environmentId,
    codexThreadId: null,
    projectId,
    title: "Project PM",
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-6",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-06-14T10:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: "/tmp/project",
    turnDiffSummaries: [],
    activities: [],
  } satisfies Thread;
  const codexDriver = ProviderDriverKind.make("codex");
  const claudeDriver = ProviderDriverKind.make("claudeAgent");
  const codexEntry = makeProviderEntry("codex", codexDriver, "Codex");
  const codexAltEntry = makeProviderEntry("codex-alt", codexDriver, "Codex Alt");
  const claudeEntry = makeProviderEntry("claudeAgent", claudeDriver, "Claude");

  it("renders a focused PM input without inert chat controls", () => {
    const markup = renderToStaticMarkup(
      <PmChatComposer
        environmentId={environmentId}
        project={project}
        projectId={projectId}
        thread={undefined}
      />,
    );

    expect(markup).toContain("Message PM");
    expect(markup).toContain("Send PM message");
    expect(markup).not.toContain("PM model:");
    expect(markup).not.toContain('role="combobox"');
    expect(markup).not.toContain('data-slot="select-trigger"');
    expect(markup).not.toContain("Ged workflow");
    expect(markup).not.toContain("Runtime mode");
    expect(markup).not.toContain("Workflow");
  });

  it("shows pending PM user-input questions in the PM composer", () => {
    const markup = renderToStaticMarkup(
      <PmChatComposer
        environmentId={environmentId}
        project={project}
        projectId={projectId}
        thread={{
          ...pmThread,
          activities: [
            {
              id: EventId.make("activity-user-input-requested"),
              kind: "user-input.requested",
              tone: "info",
              summary: "User input requested",
              payload: {
                requestId: "req-user-input-1",
                questions: [
                  {
                    id: "scope",
                    header: "Scope",
                    question: "Which scope should the PM use?",
                    options: [
                      {
                        label: "Small",
                        description: "Keep the plan narrow.",
                      },
                    ],
                    multiSelect: false,
                  },
                ],
              },
              turnId: null,
              createdAt: "2026-06-14T10:01:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Which scope should the PM use?");
    expect(markup).toContain("Small");
    expect(markup).toContain("Type your own answer");
    expect(markup).toContain("Message PM");
  });

  it("builds PM user-input answer commands for the PM thread", () => {
    const command = buildPmUserInputRespondCommand({
      threadId: pmThreadId,
      requestId: ApprovalRequestId.make("req-user-input-1"),
      answers: {
        scope: "Small",
      },
      createdAt: "2026-06-14T10:02:00.000Z",
    });

    expect(command).toMatchObject({
      type: "thread.user-input.respond",
      threadId: pmThreadId,
      requestId: "req-user-input-1",
      answers: {
        scope: "Small",
      },
      createdAt: "2026-06-14T10:02:00.000Z",
    });
    expect(command.commandId).toBeTruthy();
  });

  it("builds PM model selection updates using project orchestrator config", () => {
    const command = buildPmModelSelectionUpdateCommand({
      project,
      selection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-8",
      },
    });

    expect(command).toMatchObject({
      type: "project.meta.update",
      projectId,
      orchestratorConfig: {
        enabled: true,
        pmModelSelection: {
          instanceId: "claudeAgent",
          model: "claude-opus-4-8",
        },
      },
    });
    expect(command.commandId).toBeTruthy();
  });

  it("builds PM model selection updates carrying options", () => {
    const command = buildPmModelSelectionUpdateCommand({
      project,
      selection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "max" }],
      },
    });

    expect(command).toMatchObject({
      type: "project.meta.update",
      projectId,
      orchestratorConfig: {
        enabled: true,
        pmModelSelection: {
          instanceId: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: [{ id: "effort", value: "max" }],
        },
      },
    });
    expect(command.commandId).toBeTruthy();
  });

  it("resets PM model options when building a model-change update", () => {
    const command = buildPmModelSelectionUpdateCommand({
      project: {
        ...project,
        orchestratorConfig: {
          ...project.orchestratorConfig,
          pmModelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-sonnet-4-6",
            options: [{ id: "effort", value: "max" }],
          },
        },
      },
      selection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-8",
      },
    });

    expect(command.orchestratorConfig?.pmModelSelection).toEqual({
      instanceId: "claudeAgent",
      model: "claude-opus-4-8",
    });
  });

  it("keeps same-driver PM model selections silent", () => {
    expect(
      decidePmHarnessSwitchGate({
        currentSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        providerEntries: [codexEntry, codexAltEntry, claudeEntry],
        picked: {
          instanceId: ProviderInstanceId.make("codex-alt"),
          model: "gpt-5-codex-high",
        },
      }),
    ).toEqual({ kind: "silent" });
  });

  it("prompts when PM model selections cross driver kinds", () => {
    expect(
      decidePmHarnessSwitchGate({
        currentSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        providerEntries: [codexEntry, claudeEntry],
        picked: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
        },
      }),
    ).toMatchObject({
      kind: "cross-harness",
      fromDriver: "codex",
      fromLabel: "Codex",
      toDriver: "claudeAgent",
      toLabel: "Claude",
    });
  });

  it("keeps PM model selection silent when there is no current selection", () => {
    expect(
      decidePmHarnessSwitchGate({
        currentSelection: null,
        providerEntries: [codexEntry, claudeEntry],
        picked: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
        },
      }),
    ).toEqual({ kind: "silent" });
  });

  it("keeps removed or unknown PM model instances silent", () => {
    expect(
      decidePmHarnessSwitchGate({
        currentSelection: {
          instanceId: ProviderInstanceId.make("removed-codex"),
          model: "gpt-5-codex",
        },
        providerEntries: [claudeEntry],
        picked: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
        },
      }),
    ).toEqual({ kind: "silent" });

    expect(
      decidePmHarnessSwitchGate({
        currentSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        providerEntries: [codexEntry],
        picked: {
          instanceId: ProviderInstanceId.make("removed-claude"),
          model: "claude-sonnet-4-6",
        },
      }),
    ).toEqual({ kind: "silent" });
  });

  it("requests transcript handoff before writing a cross-harness PM selection", async () => {
    const calls: string[] = [];
    const requestPmHandoff = vi.fn(async () => {
      calls.push("handoff");
      return { accepted: true as const, mode: "transcript" as const };
    });
    const dispatchCommand = vi.fn(async () => {
      calls.push("dispatch");
      return { sequence: 1 };
    });

    await runPmHarnessSwitchAction({
      action: "transcript",
      projectId,
      project,
      selection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      requestPmHandoff,
      clearPmChat: vi.fn(),
      dispatchCommand,
    });

    expect(calls).toEqual(["handoff", "dispatch"]);
    expect(requestPmHandoff).toHaveBeenCalledWith({ projectId, mode: "transcript" });
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "project.meta.update",
        projectId,
      }),
    );
  });

  it("surfaces summary fallback and still writes the PM selection after handoff", async () => {
    const fallbacks: string[] = [];
    const calls: string[] = [];

    await runPmHarnessSwitchAction({
      action: "summary",
      projectId,
      project,
      selection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      requestPmHandoff: vi.fn(async () => {
        calls.push("handoff");
        return {
          accepted: true as const,
          mode: "transcript" as const,
          fallback: "summary backend unavailable",
        };
      }),
      clearPmChat: vi.fn(),
      dispatchCommand: vi.fn(async () => {
        calls.push("dispatch");
        return { sequence: 1 };
      }),
      onFallback: (fallback) => fallbacks.push(fallback),
    });

    expect(calls).toEqual(["handoff", "dispatch"]);
    expect(fallbacks).toEqual(["summary backend unavailable"]);
  });

  it("clears PM chat before writing a start-fresh PM selection", async () => {
    const calls: string[] = [];

    await runPmHarnessSwitchAction({
      action: "fresh",
      projectId,
      project,
      selection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      requestPmHandoff: vi.fn(),
      clearPmChat: vi.fn(async () => {
        calls.push("clear");
        return { sequence: 1 };
      }),
      dispatchCommand: vi.fn(async () => {
        calls.push("dispatch");
        return { sequence: 2 };
      }),
    });

    expect(calls).toEqual(["clear", "dispatch"]);
  });

  it("does not write a PM selection when cross-harness switching is cancelled", async () => {
    const requestPmHandoff = vi.fn();
    const clearPmChat = vi.fn();
    const dispatchCommand = vi.fn();

    await expect(
      runPmHarnessSwitchAction({
        action: "cancel",
        projectId,
        project,
        selection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        requestPmHandoff,
        clearPmChat,
        dispatchCommand,
      }),
    ).resolves.toBe(false);

    expect(requestPmHandoff).not.toHaveBeenCalled();
    expect(clearPmChat).not.toHaveBeenCalled();
    expect(dispatchCommand).not.toHaveBeenCalled();
  });
});

function makeProviderEntry(
  instanceId: string,
  driverKind: ReturnType<typeof ProviderDriverKind.make>,
  displayName: string,
): ProviderInstanceEntry {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driverKind,
    displayName,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {
      instanceId: ProviderInstanceId.make(instanceId),
      driver: driverKind,
      displayName,
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-06-14T10:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
    models: [],
  };
}
