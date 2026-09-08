import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import * as CodexSchema from "./schema.ts";
import * as CodexRpc from "./rpc.ts";

// codex-cli 0.149.1: app-server generate-json-schema --experimental,
// v2/GetAccountResponse.json definitions.PlanType (2026-09-08).
const installedPlanTypes = [
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "team",
  "self_serve_business_prolite",
  "self_serve_business_usage_based",
  "business",
  "ent26",
  "enterprise_cbp_automation",
  "enterprise_cbp_usage_based",
  "enterprise",
  "edu",
  "edu_plus",
  "edu_pro",
  "unknown",
];

const planSchemas = [
  CodexSchema.ServerNotification__PlanType,
  CodexSchema.V2AccountRateLimitsUpdatedNotification__PlanType,
  CodexSchema.V2AccountUpdatedNotification__PlanType,
  CodexSchema.V2GetAccountRateLimitsResponse__PlanType,
  CodexSchema.V2GetAccountResponse__PlanType,
];

const decodeAccount = Schema.decodeUnknownSync(CodexRpc.CLIENT_REQUEST_RESPONSES["account/read"]);
const decodeRateLimits = Schema.decodeUnknownSync(
  CodexRpc.CLIENT_REQUEST_RESPONSES["account/rateLimits/read"],
);
const decodeRateLimitsUpdated = Schema.decodeUnknownSync(
  CodexSchema.V2AccountRateLimitsUpdatedNotification,
);
const decodeAccountUpdated = Schema.decodeUnknownSync(CodexSchema.V2AccountUpdatedNotification);
const isAccount = Schema.is(CodexSchema.V2GetAccountResponse);

describe("Codex 0.149.1 account plans", () => {
  it.each(installedPlanTypes)("accepts %s in every account/rate-limit schema", (planType) => {
    for (const schema of planSchemas) {
      expect(Schema.decodeUnknownSync(schema)(planType)).toBe(planType);
    }
    const account = { type: "chatgpt", email: "redacted@example.invalid", planType };
    expect(
      decodeAccount({
        account,
        requiresOpenaiAuth: true,
      }).account,
    ).toEqual(account);
    const rateLimits = { planType };
    expect(
      decodeRateLimits({
        rateLimits,
      }).rateLimits.planType,
    ).toBe(planType);
    expect(
      decodeRateLimitsUpdated({
        rateLimits,
      }).rateLimits.planType,
    ).toBe(planType);
    expect(
      decodeAccountUpdated({
        authMode: "chatgpt",
        planType,
      }).planType,
    ).toBe(planType);
  });

  it("keeps account decoding strict instead of treating invalid plans as authenticated", () => {
    for (const schema of planSchemas) {
      expect(Schema.is(schema)("not-a-plan")).toBe(false);
      expect(Schema.is(schema)(42)).toBe(false);
      expect(Schema.is(schema)(null)).toBe(false);
    }
    expect(
      isAccount({
        account: { type: "invalid", email: "redacted@example.invalid", planType: "plus" },
        requiresOpenaiAuth: true,
      }),
    ).toBe(false);
  });
});
