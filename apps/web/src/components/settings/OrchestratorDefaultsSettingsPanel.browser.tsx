import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerConfig,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { OrchestratorDefaultsSettingsPanel } from "./SettingsPanels";

const codexId = ProviderInstanceId.make("codex");
const claudeId = ProviderInstanceId.make("claudeAgent");

afterEach(() => {
  resetServerStateForTests();
  resetAppAtomRegistryForTests();
});

it("renders global Cheap, Smart, and Genius cards with their configured harness logos", async () => {
  setServerConfigSnapshot({
    environment: {
      environmentId: EnvironmentId.make("environment-settings-presets"),
      label: "Local",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
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
        checkedAt: "2026-07-18T00:00:00.000Z",
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
      {
        instanceId: claudeId,
        driver: ProviderDriverKind.make("claudeAgent"),
        displayName: "Claude",
        enabled: true,
        installed: true,
        version: "1",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-07-18T00:00:00.000Z",
        models: [
          {
            slug: "claude-opus",
            name: "Claude Opus",
            isCustom: false,
            capabilities: createModelCapabilities({ optionDescriptors: [] }),
          },
        ],
        slashCommands: [],
        skills: [],
      },
    ],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/tmp/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      orchestratorDefaults: {
        ...DEFAULT_SERVER_SETTINGS.orchestratorDefaults,
        pmModelSelection: { instanceId: claudeId, model: "claude-opus" },
        capabilityPresets: {
          cheap: { instanceId: codexId, model: "gpt-5.6-sol" },
          smart: { instanceId: codexId, model: "gpt-5.6-sol" },
          genius: { instanceId: claudeId, model: "claude-opus" },
        },
      },
    },
  } as ServerConfig);

  await render(
    <AppAtomRegistryProvider>
      <OrchestratorDefaultsSettingsPanel />
    </AppAtomRegistryProvider>,
  );

  await expect.element(page.getByLabelText("Default PM harness")).toHaveTextContent("Claude");
  await expect
    .element(page.getByRole("img", { name: "Cheap preset uses Codex" }))
    .toBeInTheDocument();
  await expect
    .element(page.getByRole("img", { name: "Smart preset uses Codex" }))
    .toBeInTheDocument();
  await expect
    .element(page.getByRole("img", { name: "Genius preset uses Claude" }))
    .toBeInTheDocument();
});
