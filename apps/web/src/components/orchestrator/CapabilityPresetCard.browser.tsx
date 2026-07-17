import "../../index.css";

import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import { render } from "vitest-browser-react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { CapabilityPresetCard } from "./CapabilityPresetCard";

const codexId = ProviderInstanceId.make("codex");
const claudeId = ProviderInstanceId.make("claudeAgent");
const entries: ReadonlyArray<ProviderInstanceEntry> = [
  {
    instanceId: codexId,
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
        slug: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
  },
  {
    instanceId: claudeId,
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
        slug: "claude-sonnet",
        name: "Claude Sonnet",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "effort",
              label: "Reasoning",
              type: "select",
              options: [
                { id: "medium", label: "Medium" },
                { id: "high", label: "High", isDefault: true },
              ],
              currentValue: "high",
            },
          ],
        }),
      },
    ],
  },
];

async function clickVisibleSelectItem(text: string) {
  const matches = (candidate: HTMLElement) => {
    const content = candidate.textContent?.trim() ?? "";
    return text === "Inherit global" ? content.startsWith(text) : content === text;
  };
  await vi.waitFor(() => {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
    ).find((candidate) => matches(candidate) && candidate.getClientRects().length > 0);
    expect(item).toBeTruthy();
  });
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find(
    (candidate) => matches(candidate) && candidate.getClientRects().length > 0,
  );
  if (!item) throw new Error(`Missing select item ${text}`);
  await userEvent.click(item);
}

it("shows the inherited harness logo and supports override, thinking, and reset", async () => {
  const changes: Array<ModelSelection | null> = [];
  function ControlledCard() {
    const [selection, setSelection] = useState<ModelSelection | null>(null);
    return (
      <CapabilityPresetCard
        preset="smart"
        selection={selection}
        inheritedSelection={{ instanceId: claudeId, model: "claude-sonnet" }}
        instanceEntries={entries}
        allowInherit
        onSelectionChange={(next) => {
          changes.push(next);
          setSelection(next);
        }}
      />
    );
  }

  await render(<ControlledCard />);
  await expect.element(page.getByText("Inherited", { exact: true })).toBeInTheDocument();
  await expect
    .element(page.getByRole("img", { name: "Smart preset uses Claude" }))
    .toBeInTheDocument();

  await userEvent.click(page.getByLabelText("Smart harness"));
  await clickVisibleSelectItem("Claude");
  await expect.element(page.getByRole("button", { name: "High" })).toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "High" }));
  await userEvent.click(page.getByText("Medium", { exact: true }));
  await userEvent.keyboard("{Escape}");
  expect(changes.at(-1)).toEqual({
    instanceId: claudeId,
    model: "claude-sonnet",
    options: [{ id: "effort", value: "medium" }],
  });

  await userEvent.click(page.getByLabelText("Smart harness"));
  await clickVisibleSelectItem("Codex");
  await expect
    .element(page.getByRole("img", { name: "Smart preset uses Codex" }))
    .toBeInTheDocument();
  await expect.element(page.getByText("Inherited", { exact: true })).not.toBeInTheDocument();

  await userEvent.click(page.getByLabelText("Smart harness"));
  await clickVisibleSelectItem("Inherit global");
  expect(changes.at(-1)).toBeNull();
  await expect.element(page.getByText("Inherited", { exact: true })).toBeInTheDocument();
});
