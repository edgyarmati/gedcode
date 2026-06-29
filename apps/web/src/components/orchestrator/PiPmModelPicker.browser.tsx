import "../../index.css";

import { PiProviderId, type PiModelSelection } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";

import { PiPmModelPicker } from "./PiPmModelPicker";
import {
  buildEnabledPiProviderPickerEntries,
  type PiProviderPickerEntry,
} from "./projectOrchestrationSettings.logic";

function makeEntries(): PiProviderPickerEntry[] {
  return buildEnabledPiProviderPickerEntries({
    catalog: [
      {
        id: PiProviderId.make("openai"),
        displayName: "OpenAI",
        kind: "apiKey",
        configured: true,
        enabled: true,
      },
      {
        id: PiProviderId.make("anthropic"),
        displayName: "Anthropic",
        kind: "oauth",
        configured: false,
        enabled: false,
      },
    ],
    modelsByProvider: {
      openai: [
        { id: "gpt-5", name: "GPT-5", contextWindow: 128_000 },
        { id: "gpt-5-mini", name: "GPT-5 Mini", contextWindow: 128_000 },
      ],
      anthropic: [{ id: "claude-opus", name: "Claude Opus", contextWindow: 200_000 }],
    },
  });
}

function StatefulPicker({
  initialSelection = null,
  entries = makeEntries(),
  onChange,
}: {
  initialSelection?: PiModelSelection | null;
  entries?: ReadonlyArray<PiProviderPickerEntry>;
  onChange: (next: PiModelSelection | null) => void;
}) {
  const [selection, setSelection] = useState<PiModelSelection | null>(initialSelection);
  return (
    <PiPmModelPicker
      selection={selection}
      providerEntries={entries}
      unsetLabel="Use global default"
      unsetOptionLabel="Use global default (OpenAI · gpt-5)"
      providerAriaLabel="PM pi provider"
      modelAriaLabel="PM model"
      emptyHint="No pi providers enabled - add one in Settings -> PM model providers"
      onSelectionChange={(next) => {
        setSelection(next);
        onChange(next);
      }}
    />
  );
}

describe("PiPmModelPicker", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  afterEach(async () => {
    const teardown = mounted?.cleanup ?? mounted?.unmount;
    await teardown?.call(mounted);
    mounted = null;
    document.body.innerHTML = "";
  });

  it("lists only enabled pi providers", async () => {
    mounted = await render(<StatefulPicker onChange={vi.fn()} />);

    await page.getByLabelText("PM pi provider").click();

    await expect.element(page.getByText("OpenAI", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Anthropic", { exact: true })).not.toBeInTheDocument();
  });

  it("writes pi provider selections and model changes", async () => {
    const onChange = vi.fn();
    mounted = await render(<StatefulPicker onChange={onChange} />);

    await page.getByLabelText("PM pi provider").click();
    await page.getByText("OpenAI", { exact: true }).click();

    expect(onChange).toHaveBeenLastCalledWith({
      piProvider: PiProviderId.make("openai"),
      model: "gpt-5",
    });

    await page.getByLabelText("PM model").click();
    await page.getByText("GPT-5 Mini", { exact: true }).click();

    expect(onChange).toHaveBeenLastCalledWith({
      piProvider: PiProviderId.make("openai"),
      model: "gpt-5-mini",
    });
  });

  it("writes null when choosing the global default option", async () => {
    const onChange = vi.fn();
    mounted = await render(
      <StatefulPicker
        initialSelection={{ piProvider: PiProviderId.make("openai"), model: "gpt-5" }}
        onChange={onChange}
      />,
    );

    await page.getByLabelText("PM pi provider").click();
    await page.getByText("Use global default (OpenAI · gpt-5)", { exact: true }).click();

    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("shows an empty state hint when no pi providers are enabled", async () => {
    mounted = await render(<StatefulPicker entries={[]} onChange={vi.fn()} />);

    await expect
      .element(
        page.getByText("No pi providers enabled - add one in Settings -> PM model providers", {
          exact: true,
        }),
      )
      .toBeInTheDocument();
  });
});
