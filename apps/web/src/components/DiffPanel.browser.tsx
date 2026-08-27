import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import DiffPanel, { buildEmbeddedDiffSelectionIdentity } from "./DiffPanel";
import { initialEnvironmentState, useStore, type AppState } from "../store";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-diff");
const threadId = ThreadId.make("thread-embedded-diff");
const turnOneId = TurnId.make("turn-embedded-1");
const turnTwoId = TurnId.make("turn-embedded-2");

function turnSummary(turnId: TurnId, checkpointTurnCount: number) {
  return {
    turnId,
    completedAt: `2026-08-21T00:01:0${checkpointTurnCount}.000Z`,
    files: [],
    checkpointRef: undefined,
    checkpointTurnCount,
  };
}

function seedEmbeddedThread() {
  const shell = {
    id: threadId,
    environmentId,
    codexThreadId: null,
    projectId,
    title: "Embedded diff thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    error: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    archivedAt: null,
    branch: "main",
    worktreePath: null,
  };
  const state = {
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        projectIds: [projectId],
        projectById: {
          [projectId]: {
            id: projectId,
            environmentId,
            name: "Diff project",
            cwd: "/repo/diff",
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5",
            },
            scripts: [],
          },
        },
        threadIds: [threadId],
        threadShellById: { [threadId]: shell },
        turnDiffIdsByThreadId: { [threadId]: [turnOneId, turnTwoId] },
        turnDiffSummaryByThreadId: {
          [threadId]: {
            [turnOneId]: turnSummary(turnOneId, 1),
            [turnTwoId]: turnSummary(turnTwoId, 2),
          },
        },
      },
    },
  };

  useStore.setState(state as Partial<AppState>);
}

function renderEmbeddedDiffPanel() {
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <DiffPanel mode="sidebar" threadRef={scopeThreadRef(environmentId, threadId)} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return { router, renderResult: render(<RouterProvider router={router} />) };
}

describe("DiffPanel embedded turn selection", () => {
  it("scopes local selection to environment, thread, and host stage identity", () => {
    const first = buildEmbeddedDiffSelectionIdentity(
      scopeThreadRef(EnvironmentId.make("environment-a"), threadId),
      "task-a:stage-a",
    );
    expect(
      buildEmbeddedDiffSelectionIdentity(
        scopeThreadRef(EnvironmentId.make("environment-b"), threadId),
        "task-a:stage-a",
      ),
    ).not.toBe(first);
    expect(
      buildEmbeddedDiffSelectionIdentity(
        scopeThreadRef(EnvironmentId.make("environment-a"), threadId),
        "task-a:stage-b",
      ),
    ).not.toBe(first);
  });

  it("filters turns locally without navigating away from the host route", async () => {
    seedEmbeddedThread();
    const { router } = renderEmbeddedDiffPanel();

    await userEvent.click(page.getByRole("button", { name: turnTwoId }));

    expect(router.history.location.pathname).toBe("/");
    const chip = page.getByRole("button", { name: turnTwoId }).element();
    expect(chip?.getAttribute("data-turn-chip-selected")).toBe("true");

    await userEvent.click(page.getByText("All turns"));

    expect(router.history.location.pathname).toBe("/");
    const allTurnsChip = Array.from(
      document.querySelectorAll<HTMLElement>("[data-turn-chip-selected]"),
    ).find((candidate) => candidate.textContent?.includes("All turns"));
    expect(allTurnsChip?.getAttribute("data-turn-chip-selected")).toBe("true");
    expect(
      page
        .getByRole("button", { name: turnTwoId })
        .element()
        ?.getAttribute("data-turn-chip-selected"),
    ).toBe("false");
  });
});
