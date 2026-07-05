import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentApi,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import type { Project } from "../../types";
import { PmChatComposer } from "./PmChatComposer";

const environmentId = EnvironmentId.make("environment-browser");
const projectId = ProjectId.make("project-browser");

const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-06-14T10:00:00.000Z",
    models: [{ slug: "gpt-5-codex", name: "GPT-5 Codex", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-06-14T10:00:00.000Z",
    models: [
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        shortName: "Sonnet 4.6",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        shortName: "Opus 4.8",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  },
];

const serverConfig = {
  environment: {
    environmentId,
    label: "Browser environment",
    platform: { os: "darwin", arch: "arm64" },
    serverVersion: "0.0.0-test",
    capabilities: { repositoryIdentity: true },
  },
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-session-token"],
    sessionCookieName: "t3_session",
  },
  cwd: "/tmp/project",
  keybindingsConfigPath: "/tmp/project/keybindings.json",
  keybindings: [],
  issues: [],
  providers,
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/tmp/project/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
} satisfies ServerConfig;

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

function modelPickerListText() {
  return document.querySelector<HTMLElement>(".model-picker-list")?.textContent ?? "";
}

function findModelOption(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((row) =>
    row.textContent?.includes(text),
  );
}

describe("PmChatComposer model picker", () => {
  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    resetServerStateForTests();
    resetAppAtomRegistryForTests();
  });

  it("offers only Claude-driver models and persists selection through project metadata", async () => {
    const dispatchCommand = vi.fn(async (_command: unknown) => ({ sequence: 1 }));
    __setEnvironmentApiOverrideForTests(environmentId, {
      orchestration: { dispatchCommand },
      orchestrator: { sendMessage: vi.fn() },
    } as unknown as EnvironmentApi);
    setServerConfigSnapshot(serverConfig);

    await render(
      <AppAtomRegistryProvider>
        <PmChatComposer
          environmentId={environmentId}
          project={project}
          projectId={projectId}
          thread={undefined}
        />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: /Sonnet 4\.6/u }).click();

    await vi.waitFor(() => {
      expect(modelPickerListText()).toContain("Claude Opus 4.8");
    });
    expect(modelPickerListText()).not.toContain("GPT-5 Codex");
    expect(document.querySelector('[data-model-picker-provider="codex"]')).toBeNull();

    const opusOption = findModelOption("Claude Opus 4.8");
    expect(opusOption).toBeTruthy();
    await userEvent.click(opusOption!);

    await expect.poll(() => dispatchCommand.mock.calls.length).toBe(1);
    expect(dispatchCommand.mock.calls.at(0)?.[0]).toMatchObject({
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
  });
});
