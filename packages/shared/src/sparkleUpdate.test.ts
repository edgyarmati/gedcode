import { describe, expect, it } from "vitest";

import {
  resolveSparkleAppcastUrl,
  resolveSparkleUpdateChannel,
  sparkleAppcastAssetName,
  sparkleAppcastUrl,
} from "./sparkleUpdate.ts";

describe("Sparkle update configuration", () => {
  it("maps stable and nightly releases onto durable feed assets", () => {
    expect(resolveSparkleUpdateChannel("0.4.4")).toBe("latest");
    expect(resolveSparkleUpdateChannel("0.4.5-nightly.20260827.1")).toBe("nightly");
    expect(sparkleAppcastAssetName("latest")).toBe("appcast-latest.xml");
    expect(sparkleAppcastUrl("nightly")).toBe(
      "https://github.com/edgyarmati/gedcode/releases/download/sparkle-feed/appcast-nightly.xml",
    );
    expect(resolveSparkleAppcastUrl("0.4.4")).toBe(
      "https://github.com/edgyarmati/gedcode/releases/download/sparkle-feed/appcast-latest.xml",
    );
  });

  it("keeps development and mock-update builds off the production Sparkle feed", () => {
    expect(resolveSparkleUpdateChannel("0.4.4-dev")).toBeNull();
    expect(resolveSparkleAppcastUrl("0.4.4-dev.local")).toBeNull();
  });
});
