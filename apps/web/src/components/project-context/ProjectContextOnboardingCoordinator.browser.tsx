import "../../index.css";

import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProjectContextRunId,
  ProjectId,
  type EnvironmentApi,
  type ServerConfig,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { initialEnvironmentState, useStore } from "../../store";
import type { Project } from "../../types";
import { ProjectContextOnboardingCoordinator } from "./ProjectContextOnboardingCoordinator";
import { ProjectContextTierCard } from "./ProjectContextTierCard";

const route = vi.hoisted(() => ({ pathname: "/orch/environment-context/project-context" }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
      select({ pathname: route.pathname }),
  };
});

const environmentId = EnvironmentId.make("environment-context");
const projectId = ProjectId.make("project-context");
const codexId = ProviderInstanceId.make("codex-context");

const project: Project = {
  id: projectId,
  environmentId,
  name: "Context project",
  cwd: "/repo/context-project",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
};

function installProject() {
  useStore.setState({
    activeEnvironmentId: environmentId,
    environmentStateById: {
      [environmentId]: {
        ...initialEnvironmentState,
        projectIds: [projectId],
        projectById: { [projectId]: project },
      },
    },
  });
}

function onboarding(input: {
  readonly fingerprint: string;
  readonly promptKind: "populate" | "review";
}) {
  return {
    shouldPrompt: true,
    schemaVersion: 1,
    fingerprint: input.fingerprint,
    promptKind: input.promptKind,
    files:
      input.promptKind === "populate"
        ? [
            { path: "AGENTS.md", classification: "missing" },
            { path: ".ged/PROJECT.md", classification: "stub" },
          ]
        : [{ path: "AGENTS.md", classification: "substantive" }],
  };
}

function serverConfig(defaultTier: "cheap" | "smart" | "genius"): ServerConfig {
  const selection = {
    instanceId: codexId,
    model: "gpt-5.6-sol",
    options: [{ id: "thinking", value: "medium" }],
  };
  return {
    providers: [
      {
        instanceId: codexId,
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex",
        enabled: true,
        installed: true,
        version: "1",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-07-20T00:00:00.000Z",
        models: [
          {
            slug: "gpt-5.6-sol",
            name: "GPT-5.6 Sol",
            isCustom: false,
            capabilities: createModelCapabilities({ optionDescriptors: [] }),
          },
        ],
        slashCommands: [],
        skills: [],
      },
    ],
    settings: {
      orchestratorDefaults: {
        capabilityPresets: {
          cheap: selection,
          smart: selection,
          genius: selection,
        },
        projectContextDefaultTier: defaultTier,
      },
    },
  } as unknown as ServerConfig;
}

function installApi(input: {
  readonly getOnboarding: () => ReturnType<typeof onboarding> | { shouldPrompt: false };
  readonly getConfig: () => ServerConfig;
  readonly dismiss?: EnvironmentApi["orchestrator"]["dismissProjectContextOnboarding"];
  readonly request?: EnvironmentApi["orchestrator"]["requestProjectContextRun"];
}) {
  const getProjectContextOnboarding = vi.fn(async () => input.getOnboarding());
  const getConfig = vi.fn(async () => input.getConfig());
  const dismissProjectContextOnboarding = input.dismiss ?? vi.fn(async () => ({ sequence: 1 }));
  const requestProjectContextRun =
    input.request ??
    vi.fn(async () => ({
      runId: ProjectContextRunId.make("run-context"),
      sequence: 1,
    }));
  __setEnvironmentApiOverrideForTests(environmentId, {
    server: { getConfig },
    orchestrator: {
      getPresetMigration: async () => ({ status: "completed" }),
      getProjectContextOnboarding,
      dismissProjectContextOnboarding,
      requestProjectContextRun,
    },
  } as unknown as EnvironmentApi);
  return {
    getProjectContextOnboarding,
    getConfig,
    dismissProjectContextOnboarding,
    requestProjectContextRun,
  };
}

async function renderCoordinator(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ProjectContextOnboardingCoordinator />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });
  route.pathname = "/orch/environment-context/project-context";
});

it("renders harness, model, and thinking details, then remembers the chosen tier", async () => {
  installProject();
  let shouldPrompt = true;
  let defaultTier: "cheap" | "smart" | "genius" = "smart";
  const api = installApi({
    getOnboarding: () =>
      shouldPrompt
        ? onboarding({ fingerprint: "fingerprint-one", promptKind: "review" })
        : { shouldPrompt: false },
    getConfig: () => serverConfig(defaultTier),
    request: vi.fn(async ({ tier }) => {
      defaultTier = tier;
      shouldPrompt = false;
      return { runId: ProjectContextRunId.make("run-context"), sequence: 1 };
    }),
  });

  const client = new QueryClient();
  const mounted = await renderCoordinator(client);
  await expect
    .element(page.getByRole("heading", { name: "Review project context?" }))
    .toBeInTheDocument();
  await expect
    .element(page.getByRole("img", { name: "Smart preset uses Codex" }))
    .toBeInTheDocument();
  await expect.element(page.getByText(/gpt-5\.6-sol · medium/u).first()).toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: /Smart/ }))
    .toHaveAttribute("aria-pressed", "true");

  await userEvent.click(page.getByRole("button", { name: /Cheap/ }));
  await userEvent.click(page.getByRole("button", { name: "Review context" }));
  await vi.waitFor(() => {
    expect(api.requestProjectContextRun).toHaveBeenCalledWith({
      projectId,
      tier: "cheap",
    });
  });
  await expect
    .element(page.getByRole("heading", { name: "Review project context?" }))
    .not.toBeInTheDocument();

  shouldPrompt = true;
  await mounted.unmount();
  await renderCoordinator();
  await expect
    .element(page.getByRole("button", { name: /Cheap/ }))
    .toHaveAttribute("aria-pressed", "true");
});

it("uses Populate for missing or stub context, accepts dismissal, and re-prompts for a new fingerprint", async () => {
  installProject();
  let current = onboarding({ fingerprint: "fingerprint-one", promptKind: "populate" });
  const api = installApi({
    getOnboarding: () => current,
    getConfig: () => serverConfig("smart"),
    dismiss: vi.fn(async () => {
      current = { shouldPrompt: false } as typeof current;
      return { sequence: 2 };
    }),
  });

  const client = new QueryClient();
  const mounted = await renderCoordinator(client);
  await expect
    .element(page.getByRole("heading", { name: "Populate project context?" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("missing", { exact: true })).toBeInTheDocument();
  await expect.element(page.getByText("stub", { exact: true })).toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Dismiss for now" }));
  await vi.waitFor(() => {
    expect(api.dismissProjectContextOnboarding).toHaveBeenCalledWith({
      projectId,
      schemaVersion: 1,
      fingerprint: "fingerprint-one",
    });
  });
  await expect
    .element(page.getByRole("heading", { name: "Populate project context?" }))
    .not.toBeInTheDocument();

  current = onboarding({ fingerprint: "fingerprint-two", promptKind: "review" });
  await mounted.unmount();
  await renderCoordinator();
  await expect
    .element(page.getByRole("heading", { name: "Review project context?" }))
    .toBeInTheDocument();
});

it("keeps one onboarding query while navigating between Orchestrator and Chat for the same project", async () => {
  installProject();
  const api = installApi({
    getOnboarding: () => onboarding({ fingerprint: "fingerprint-shared", promptKind: "review" }),
    getConfig: () => serverConfig("smart"),
  });

  const client = new QueryClient();
  const mounted = await renderCoordinator(client);
  await expect
    .element(page.getByRole("heading", { name: "Review project context?" }))
    .toBeInTheDocument();
  expect(api.getProjectContextOnboarding).toHaveBeenCalledTimes(1);

  const threadId = "thread-context" as const;
  useStore.setState((state) => ({
    environmentStateById: {
      ...state.environmentStateById,
      [environmentId]: {
        ...state.environmentStateById[environmentId]!,
        threadShellById: {
          [threadId]: {
            id: threadId,
            environmentId,
            projectId,
            codexThreadId: null,
            title: "Context chat",
            modelSelection: { instanceId: codexId, model: "gpt-5.6-sol" },
            runtimeMode: "full-access",
            interactionMode: "default",
            error: null,
            createdAt: "2026-07-20T00:00:00.000Z",
            archivedAt: null,
            branch: null,
            worktreePath: null,
          },
        },
      },
    },
  }));
  route.pathname = `/environment-context/${threadId}`;
  await mounted.rerender(
    <QueryClientProvider client={client}>
      <ProjectContextOnboardingCoordinator />
    </QueryClientProvider>,
  );
  await expect
    .element(page.getByRole("heading", { name: "Review project context?" }))
    .toBeInTheDocument();
  expect(api.getProjectContextOnboarding).toHaveBeenCalledTimes(1);
});

it("renders a selectable tier card with its configured harness, model, and thinking level", async () => {
  const onSelect = vi.fn();
  await render(
    <ProjectContextTierCard
      tier="genius"
      selection={{
        instanceId: codexId,
        model: "gpt-5.6-sol",
        options: [{ id: "thinking", value: "high" }],
      }}
      instanceEntries={[
        {
          instanceId: codexId,
          driverKind: ProviderDriverKind.make("codex"),
          displayName: "Codex",
          enabled: true,
          installed: true,
          status: "ready",
          isDefault: true,
          isAvailable: true,
          snapshot: {} as never,
          models: [],
        },
      ]}
      selected={false}
      onSelect={onSelect}
    />,
  );
  await expect
    .element(page.getByRole("img", { name: "Genius preset uses Codex" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("Codex · gpt-5.6-sol · high")).toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: /Genius/ }));
  expect(onSelect).toHaveBeenCalledOnce();
});
