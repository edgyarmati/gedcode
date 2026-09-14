import { describe, expect, it } from "vitest";
import { digestPairingCredential } from "./pairingCredentialDigest.ts";

// Fixed independent SHA-256 answers; exact UTF-8 input, no normalization or trimming.
const vectors = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["\u00e9\u0000\ud83d\ude00", "2ef3b1c8e8eed9fe539f0f94927fc4760bbe9fa9366d5899e201ddfcd0e1470e"],
  ["a\u0000b", "59b271ae1bbcb1d31d41929817f4b16fb439eb4f31520b5ad1d5ce98920a7138"],
  ["\ufffd", "83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097"],
] as const;
describe("pairing credential digest compatibility", () => {
  for (const [credential, digest] of vectors) {
    it(`hashes ${JSON.stringify(credential)} to fixed lowercase hex`, () => {
      expect(digestPairingCredential(credential)).toBe(digest);
    });
  }
  it("retains Node UTF-8 replacement for a lone surrogate", () => {
    expect(digestPairingCredential("\ud800")).toBe(vectors[4][1]);
  });
});
