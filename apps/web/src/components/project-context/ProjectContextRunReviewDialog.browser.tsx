import "../../index.css";

import {
  EnvironmentId,
  ProjectContextRunId,
  ProjectId,
  type EnvironmentApi,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { ProjectContextRunReviewDialog } from "./ProjectContextRunReviewDialog";

const environmentId = EnvironmentId.make("environment-context-review");
const projectId = ProjectId.make("project-context-review");
const runId = ProjectContextRunId.make("run-context-review");
const review = {
  runId,
  result: "Updated the durable agent guidance and project architecture notes.",
  changes: [
    { path: "AGENTS.md" as const, kind: "modified" as const },
    { path: ".ged/ARCHITECTURE.md" as const, kind: "added" as const },
  ],
  diff: "diff --project-context a/AGENTS.md b/AGENTS.md\n-old guidance\n+new guidance",
  diffTruncated: false,
  scopeViolationPaths: [],
  conflict: null,
};

function installApi() {
  const getProjectContextRunReview = vi.fn(async () => ({ review }));
  const commitProjectContextRun = vi.fn(async () => ({
    runId,
    commitHash: "a".repeat(40),
    sequence: 10,
  }));
  const reviseProjectContextRun = vi.fn(async () => ({ runId, sequence: 11 }));
  const discardProjectContextRun = vi.fn(async () => ({ runId, sequence: 12 }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    orchestrator: {
      getProjectContextRunReview,
      commitProjectContextRun,
      reviseProjectContextRun,
      discardProjectContextRun,
    },
  } as unknown as EnvironmentApi);
  return {
    getProjectContextRunReview,
    commitProjectContextRun,
    reviseProjectContextRun,
    discardProjectContextRun,
  };
}

async function renderReview() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectContextRunReviewDialog
        environmentId={environmentId}
        projectId={projectId}
        runId={runId}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  vi.restoreAllMocks();
});

it("shows the exact proposal and commits only after an explicit review action", async () => {
  const api = installApi();
  await renderReview();

  await expect
    .element(page.getByRole("heading", { name: "Review project context changes" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("AGENTS.md", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByText(/new guidance/u)).toBeInTheDocument();
  expect(api.commitProjectContextRun).not.toHaveBeenCalled();

  await userEvent.fill(
    page.getByRole("textbox", { name: "Project context commit message" }),
    "docs(context): clarify agent workflow",
  );
  await userEvent.click(page.getByRole("button", { name: "Commit context changes" }));
  await vi.waitFor(() => {
    expect(api.commitProjectContextRun).toHaveBeenCalledWith({
      runId,
      message: "docs(context): clarify agent workflow",
    });
  });
});

it("supports iterative revision and confirmed discard without client-supplied paths", async () => {
  const api = installApi();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const mounted = await renderReview();

  await userEvent.fill(
    page.getByRole("textbox", { name: "Project context revision instructions" }),
    "Keep the architecture section shorter and add the verification command.",
  );
  await userEvent.click(page.getByRole("button", { name: "Revise" }));
  await vi.waitFor(() => {
    expect(api.reviseProjectContextRun).toHaveBeenCalledWith({
      runId,
      instructions: "Keep the architecture section shorter and add the verification command.",
    });
  });

  await mounted.unmount();
  const discardApi = installApi();
  await renderReview();
  await userEvent.click(page.getByRole("button", { name: "Discard" }));
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => {
    expect(discardApi.discardProjectContextRun).toHaveBeenCalledWith({ runId });
  });
});
