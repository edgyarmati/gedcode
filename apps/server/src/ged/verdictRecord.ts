/**
 * The verdict record the land gate reads: one file per branch, holding every
 * verifier's ruling on one commit. `.ged/bin/land-gate.sh` decides what the
 * rulings add up to; this module only keeps the record well-formed as rulings
 * arrive, possibly from verifiers running in parallel.
 */

export interface VerdictParticipant {
  readonly driverKind: string;
  readonly model?: string | undefined;
  readonly taskId?: string | undefined;
}

export interface VerdictCriterion {
  readonly criterion: string;
  readonly verdict: "met" | "not_met" | "unverifiable";
  readonly evidence: string;
}

export interface VerdictReview {
  readonly verifier: VerdictParticipant;
  readonly status: "pass" | "fail";
  readonly criteria: ReadonlyArray<VerdictCriterion>;
  /**
   * Whether a provider of another vendor than the implementer's could have run
   * this review. Determined by the server when the ruling is recorded, so the
   * gate can accept a same-vendor-only record only when there was no choice.
   */
  readonly otherVendorAvailable: boolean;
}

export interface VerdictRecord {
  readonly schemaVersion: 2;
  readonly branch: string;
  readonly headSha: string;
  readonly implementer: VerdictParticipant;
  readonly reviews: ReadonlyArray<VerdictReview>;
}

export interface VerdictRuling {
  readonly branch: string;
  readonly headSha: string;
  readonly implementer: VerdictParticipant;
  readonly review: VerdictReview;
}

/** Vendors compare by driver kind, case-insensitively, as the gate does. */
export const sameVendor = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

const sameVerifier = (left: VerdictParticipant, right: VerdictParticipant): boolean =>
  sameVendor(left.driverKind, right.driverKind) &&
  (left.model ?? "").trim().toLowerCase() === (right.model ?? "").trim().toLowerCase();

const isContinuable = (existing: unknown, ruling: VerdictRuling): existing is VerdictRecord => {
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) return false;
  const record = existing as Partial<VerdictRecord>;
  return (
    record.schemaVersion === 2 &&
    record.branch === ruling.branch &&
    record.headSha === ruling.headSha &&
    typeof record.implementer?.driverKind === "string" &&
    sameVendor(record.implementer.driverKind, ruling.implementer.driverKind) &&
    Array.isArray(record.reviews)
  );
};

/**
 * Adds a ruling to the branch's record. A ruling on the same commit and
 * implementer joins the existing reviews, replacing an earlier ruling by the
 * same verifier; anything else (a new commit, a malformed or older record)
 * starts the record over, because rulings on another commit say nothing about
 * this one.
 */
export const mergeRuling = (existing: unknown, ruling: VerdictRuling): VerdictRecord => {
  const kept = isContinuable(existing, ruling)
    ? existing.reviews.filter((review) => !sameVerifier(review.verifier, ruling.review.verifier))
    : [];
  return {
    schemaVersion: 2,
    branch: ruling.branch,
    headSha: ruling.headSha,
    implementer: ruling.implementer,
    reviews: [...kept, ruling.review],
  };
};
