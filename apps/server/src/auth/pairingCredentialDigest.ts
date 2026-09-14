// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createHash } from "node:crypto";

/** One-way digest used to look up pairing credentials without persisting their raw value. */
export function digestPairingCredential(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}
