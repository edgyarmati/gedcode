import { describe, expect, it } from "vitest";

import { resolveDefaultLanding, type DefaultLandingAuthStatus } from "./defaultLanding.logic";

describe("resolveDefaultLanding", () => {
  const cases: ReadonlyArray<{
    readonly authGateStatus: DefaultLandingAuthStatus;
    readonly savedEnvironmentCount: number;
    readonly expected: "/chat" | "/orch" | "/pair";
  }> = [
    { authGateStatus: "authenticated", savedEnvironmentCount: 0, expected: "/orch" },
    { authGateStatus: "authenticated", savedEnvironmentCount: 2, expected: "/orch" },
    { authGateStatus: "hosted-static", savedEnvironmentCount: 0, expected: "/chat" },
    { authGateStatus: "hosted-static", savedEnvironmentCount: 2, expected: "/orch" },
    { authGateStatus: "hosted-pairing", savedEnvironmentCount: 0, expected: "/pair" },
    { authGateStatus: "hosted-pairing", savedEnvironmentCount: 2, expected: "/pair" },
    { authGateStatus: "requires-auth", savedEnvironmentCount: 0, expected: "/pair" },
    { authGateStatus: "requires-auth", savedEnvironmentCount: 2, expected: "/pair" },
  ];

  for (const testCase of cases) {
    it(`routes ${testCase.authGateStatus} with ${testCase.savedEnvironmentCount} saved environments to ${testCase.expected}`, () => {
      expect(resolveDefaultLanding(testCase)).toBe(testCase.expected);
    });
  }
});
