import { describe, expect, it } from "vitest";

import { pullRequestPollDelayMs } from "./PullRequestSyncReactor.ts";

describe("PullRequestSyncReactor", () => {
  const cadence = {
    activePollIntervalMs: 15_000,
    backgroundPollIntervalMs: 60_000,
    failureRetryIntervalMs: 120_000,
  };

  it("uses a fast first poll, then backs healthy tracked PRs off to background cadence", () => {
    expect(pullRequestPollDelayMs({ ...cadence, active: true, retrying: false })).toBe(15_000);
    expect(pullRequestPollDelayMs({ ...cadence, active: false, retrying: false })).toBe(60_000);
  });

  it("gives an unavailable provider its retry cadence without invoking a model", () => {
    expect(pullRequestPollDelayMs({ ...cadence, active: false, retrying: true })).toBe(120_000);
  });
});
