import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CodexSettings } from "@t3tools/contracts";
import * as CodexSchema from "effect-codex-app-server/schema";

import {
  appendCustomCodexModels,
  checkCodexProviderStatus,
  mapCodexModelCapabilities,
  parseCodexModelListResponse,
} from "./CodexProvider.ts";

const decodeModels = Schema.decodeUnknownSync(CodexSchema.V2ModelListResponse);

const decodeAccount = Schema.decodeUnknownEffect(CodexSchema.V2GetAccountResponse);
const decodeSettings = Schema.decodeUnknownEffect(CodexSettings);

it("maps Codex reasoning while using the app's Standard service default", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it.layer(NodeServices.layer)("Codex account compatibility", (it) => {
  for (const [planType, label] of [
    ["self_serve_business_prolite", "ChatGPT Business Subscription"],
    ["ent26", "ChatGPT Enterprise Subscription"],
    ["enterprise_cbp_automation", "ChatGPT Enterprise Subscription"],
    ["edu_plus", "ChatGPT Edu Subscription"],
    ["edu_pro", "ChatGPT Edu Subscription"],
    ["plus", "ChatGPT Plus Subscription"],
  ]) {
    it.effect(`recognizes authenticated ${planType} accounts`, () =>
      Effect.gen(function* () {
        const account = yield* decodeAccount({
          account: { type: "chatgpt", email: "redacted@example.invalid", planType },
          requiresOpenaiAuth: true,
        });
        const snapshot = yield* checkCodexProviderStatus(yield* decodeSettings({}), () =>
          Effect.succeed({ account, version: "0.149.1", models: [], skills: [] }),
        );
        assert.equal(snapshot.status, "ready");
        assert.equal(snapshot.auth.status, "authenticated");
        assert.equal(snapshot.auth.label, label);
        assert.equal(snapshot.version, "0.149.1");
      }),
    );
  }
});

it("preserves the official Astra ID and capabilities when advertised by Codex", () => {
  // Synthetic catalog entry: the ID is official, but capabilities/access must come
  // from the account's catalog, not a hardcoded Astra capability/default table.
  const models = parseCodexModelListResponse(
    decodeModels({
      data: [
        {
          id: "catalog-row-astra",
          model: "gpt-6-astra",
          displayName: "GPT-6 Astra",
          description: "Catalog test fixture",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "catalog-effort",
          supportedReasoningEfforts: [
            { reasoningEffort: "catalog-effort", description: "From catalog" },
          ],
        },
      ],
      nextCursor: null,
    }),
  );
  assert.deepStrictEqual(models, [
    {
      slug: "gpt-6-astra",
      name: "GPT-6 Astra",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [{ id: "catalog-effort", label: "catalog-effort", isDefault: true }],
            currentValue: "catalog-effort",
          },
        ],
      },
    },
  ]);
  assert.deepStrictEqual(appendCustomCodexModels(models, ["gpt-6-astra"]), models);
});

it("does not invent Astra availability but retains an explicitly configured custom ID", () => {
  const models = parseCodexModelListResponse(decodeModels({ data: [], nextCursor: null }));
  assert.deepStrictEqual(appendCustomCodexModels(models, []), []);
  assert.deepStrictEqual(appendCustomCodexModels(models, [" gpt-6-astra ", "gpt-6-astra"]), [
    {
      slug: "gpt-6-astra",
      name: "gpt-6-astra",
      isCustom: true,
      capabilities: null,
    },
  ]);
});
