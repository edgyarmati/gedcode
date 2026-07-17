import "../../index.css";

import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentApi,
  type OrchestratorPresetMigrationState,
  type ServerConfig,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { OrchestratorPresetMigrationGate } from "./OrchestratorPresetMigrationGate";

const environmentId = EnvironmentId.make("environment-migration-browser");
const requiredState: OrchestratorPresetMigrationState = {
  status: "required",
  legacyGlobalSelection: null,
  projects: [],
};
const completedState: OrchestratorPresetMigrationState = {
  ...requiredState,
  status: "completed",
};
const config = {
  providers: [
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      enabled: true,
      installed: true,
      version: "1",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-17T00:00:00.000Z",
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
} as unknown as ServerConfig;

afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
});

async function clickSelectItem(text: string) {
  await vi.waitFor(() => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
    ).find(
      (candidate) => candidate.textContent?.includes(text) && candidate.getClientRects().length > 0,
    );
    expect(item).toBeTruthy();
  });
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find(
    (candidate) => candidate.textContent?.includes(text) && candidate.getClientRects().length > 0,
  );
  if (!item) throw new Error(`Missing select item ${text}`);
  await userEvent.click(item);
}

function installApi(input: {
  getState: () => Promise<OrchestratorPresetMigrationState>;
  complete?: EnvironmentApi["orchestrator"]["completePresetMigration"];
}) {
  __setEnvironmentApiOverrideForTests(environmentId, {
    server: { getConfig: async () => config },
    orchestrator: {
      getPresetMigration: input.getState,
      completePresetMigration: input.complete ?? (async () => completedState),
    },
  } as EnvironmentApi);
}

it("blocks deep-linked Orchestrator content until required setup is completed", async () => {
  installApi({ getState: async () => requiredState });
  await render(
    <OrchestratorPresetMigrationGate environmentId={environmentId}>
      <p>Deep-linked task content</p>
    </OrchestratorPresetMigrationGate>,
  );

  await expect
    .element(page.getByRole("heading", { name: "Choose how the Orchestrator delegates work" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("Deep-linked task content")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Review projects" })).toBeDisabled();
});

it("unlocks after explicit preset choices and stays unlocked after a remount", async () => {
  let persisted = false;
  const complete = vi.fn(async () => {
    persisted = true;
    return completedState;
  });
  installApi({
    getState: async () => (persisted ? completedState : requiredState),
    complete,
  });
  const mounted = await render(
    <OrchestratorPresetMigrationGate environmentId={environmentId}>
      <p>Orchestrator unlocked</p>
    </OrchestratorPresetMigrationGate>,
  );

  for (const preset of ["Cheap", "Smart", "Genius"]) {
    await userEvent.click(page.getByLabelText(`${preset} harness`));
    await clickSelectItem("Codex");
  }
  await userEvent.click(page.getByRole("button", { name: "Review projects" }));
  await userEvent.click(page.getByRole("button", { name: "Finish required setup" }));

  await expect.element(page.getByText("Orchestrator unlocked")).toBeInTheDocument();
  expect(complete).toHaveBeenCalledWith({
    globalPresets: {
      cheap: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      smart: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      genius: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
    },
    projects: [],
  });

  await mounted.unmount();
  await render(
    <OrchestratorPresetMigrationGate environmentId={environmentId}>
      <p>Orchestrator restored after restart</p>
    </OrchestratorPresetMigrationGate>,
  );
  await expect.element(page.getByText("Orchestrator restored after restart")).toBeInTheDocument();
});
