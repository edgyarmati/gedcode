import "../../index.css";

import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { BackendModelPicker } from "./RoleBackendPicker";

const claudeInstanceId = ProviderInstanceId.make("claudeAgent");
const codexInstanceId = ProviderInstanceId.make("codex");

const instanceEntries: ReadonlyArray<ProviderInstanceEntry> = [
  {
    instanceId: codexInstanceId,
    driverKind: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {} as ProviderInstanceEntry["snapshot"],
    models: [
      {
        slug: "gpt-5",
        name: "GPT-5",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
  },
  {
    instanceId: claudeInstanceId,
    driverKind: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {} as ProviderInstanceEntry["snapshot"],
    models: [
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        shortName: "Sonnet 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "effort",
              label: "Reasoning",
              type: "select",
              options: [
                { id: "low", label: "Low" },
                { id: "high", label: "High", isDefault: true },
              ],
              currentValue: "high",
            },
          ],
        }),
      },
      {
        slug: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        shortName: "Opus 4.8",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
  },
];

async function clickSelectItem(text: string) {
  await vi.waitFor(() => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
    ).find((candidate) => candidate.textContent?.includes(text));
    expect(item).toBeTruthy();
  });
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!item) throw new Error(`Missing select item ${text}`);
  await userEvent.click(item);
}

describe("BackendModelPicker", () => {
  it("emits worker model selections for PM backend picking", async () => {
    const changes: Array<ModelSelection | null> = [];
    await render(
      <BackendModelPicker
        selection={null}
        instanceEntries={instanceEntries}
        unsetLabel="Use global default"
        unsetOptionLabel="Use global default"
        backendAriaLabel="PM backend"
        modelAriaLabel="PM model"
        onSelectionChange={(next) => changes.push(next)}
      />,
    );

    await userEvent.click(page.getByLabelText("PM backend"));
    await clickSelectItem("Claude");

    expect(changes).toEqual([
      {
        instanceId: claudeInstanceId,
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "high" }],
      },
    ]);
  });

  it("emits model updates for the selected backend", async () => {
    const changes: Array<ModelSelection | null> = [];
    await render(
      <BackendModelPicker
        selection={{ instanceId: claudeInstanceId, model: "claude-sonnet-4-6" }}
        instanceEntries={instanceEntries}
        unsetLabel="Use global default"
        unsetOptionLabel="Use global default"
        backendAriaLabel="PM backend"
        modelAriaLabel="PM model"
        onSelectionChange={(next) => changes.push(next)}
      />,
    );

    await userEvent.click(page.getByLabelText("PM model"));
    await clickSelectItem("Opus 4.8");

    expect(changes).toEqual([{ instanceId: claudeInstanceId, model: "claude-opus-4-8" }]);
  });

  it("edits the thinking level on a controlled worker selection", async () => {
    const changes: Array<ModelSelection | null> = [];
    function ControlledPicker() {
      const [selection, setSelection] = useState<ModelSelection>({
        instanceId: claudeInstanceId,
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "high" }],
      });
      return (
        <BackendModelPicker
          selection={selection}
          instanceEntries={instanceEntries}
          unsetLabel="Use global default"
          unsetOptionLabel="Use global default"
          backendAriaLabel="Worker harness"
          modelAriaLabel="Worker model"
          onSelectionChange={(next) => {
            changes.push(next);
            if (next) setSelection(next);
          }}
        />
      );
    }

    await render(<ControlledPicker />);
    await userEvent.click(page.getByRole("button", { name: "High" }));
    await userEvent.click(page.getByText("Low", { exact: true }));

    expect(changes.at(-1)).toEqual({
      instanceId: claudeInstanceId,
      model: "claude-sonnet-4-6",
      options: [{ id: "effort", value: "low" }],
    });
  });
});
