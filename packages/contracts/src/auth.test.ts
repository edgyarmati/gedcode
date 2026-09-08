import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { AuthPairingLink } from "./auth.ts";

const decodeAuthPairingLink = Schema.decodeUnknownSync(AuthPairingLink);

describe("AuthPairingLink", () => {
  it("decodes show-once pairing link metadata without a credential", () => {
    const pairingLink = decodeAuthPairingLink({
      id: "pairing-1",
      role: "client",
      subject: "one-time-token",
      label: "Phone",
      createdAt: DateTime.makeUnsafe("2026-08-30T12:00:00.000Z"),
      expiresAt: DateTime.makeUnsafe("2026-08-30T12:05:00.000Z"),
    });

    expect(pairingLink.id).toBe("pairing-1");
    expect("credential" in pairingLink).toBe(false);
    expect("credentialDigest" in pairingLink).toBe(false);
  });
});
