import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { ProviderQuotaStatusRepositoryShape } from "../persistence/Services/ProviderQuotaStatus.ts";

/**
 * Optimistically clear trustworthy quota blocks whose reported reset has passed.
 *
 * Providers can omit a follow-up rate-limit event after a reset. A subsequent
 * turn remains the authority: it will re-block the instance if the provider did
 * not actually replenish quota.
 */
export const recoverElapsedProviderQuotaBlocks = Effect.fn("recoverElapsedProviderQuotaBlocks")(
  function* (input: { readonly quota: ProviderQuotaStatusRepositoryShape }) {
    const now = yield* DateTime.now;
    const nowIso = DateTime.formatIso(now);
    const elapsed = (yield* input.quota.listBlocked()).filter(
      (row) =>
        row.status === "blocked-until" &&
        row.resetAt !== null &&
        Date.parse(row.resetAt) <= now.epochMilliseconds,
    );

    return yield* Effect.forEach(
      elapsed,
      (row) =>
        input.quota
          .upsert({
            providerInstanceId: row.providerInstanceId,
            status: "ok",
            resetAt: null,
            updatedAt: nowIso,
          })
          .pipe(Effect.as(row)),
      { concurrency: 1 },
    );
  },
);
