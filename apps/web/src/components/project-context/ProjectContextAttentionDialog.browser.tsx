import "../../index.css";

import {
  EnvironmentId,
  ProjectContextRunId,
  ProjectId,
  type EnvironmentApi,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { ProjectContextAttentionDialog } from "./ProjectContextAttentionDialog";

const environmentId = EnvironmentId.make("environment-context-attention");
const projectId = ProjectId.make("project-context-attention");
const runId = ProjectContextRunId.make("run-context-attention");

afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  vi.restoreAllMocks();
});

it("offers deterministic reconciliation without restoring the legacy commit workflow", async () => {
  const resolveProjectContextRunAttention = vi.fn(async () => ({ runId, sequence: 12 }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: {
      getProjectContextRunReview: vi.fn(async () => ({
        review: {
          runId,
          result: "Updated project guidance.",
          changes: [{ path: "AGENTS.md", kind: "modified" }],
          diff: "",
          diffTruncated: false,
          scopeViolationPaths: [],
          conflict: {
            kind: "context-drift",
            detail: "AGENTS.md changed concurrently.",
            paths: ["AGENTS.md"],
            autoReconcile: true,
            actions: ["retry", "reconcile", "hand-to-pm", "discard"],
          },
        },
      })),
      resolveProjectContextRunAttention,
    },
  } as unknown as EnvironmentApi);

  await render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectContextAttentionDialog
        environmentId={environmentId}
        onOpenChange={() => undefined}
        open
        projectId={projectId}
        runId={runId}
      />
    </QueryClientProvider>,
  );

  await expect.element(page.getByText("Safe merge available")).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Hand to PM" })).toBeInTheDocument();
  await page.getByRole("button", { name: "Reconcile" }).click();
  await vi.waitFor(() => {
    expect(resolveProjectContextRunAttention).toHaveBeenCalledWith({
      runId,
      action: "reconcile",
    });
  });
  await expect.element(page.getByText("Commit context changes")).not.toBeInTheDocument();
});
