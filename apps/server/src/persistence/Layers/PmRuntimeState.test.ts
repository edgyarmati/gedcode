import { ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PmRuntimeStateRepository } from "../Services/PmRuntimeState.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { PmRuntimeStateRepositoryLive } from "./PmRuntimeState.ts";

const TestLayer = PmRuntimeStateRepositoryLive.pipe(Layer.provide(SqlitePersistenceMemory));
const layer = it.layer(Layer.fresh(TestLayer));

layer("PmRuntimeStateRepository", (it) => {
  it.effect("atomically consumes a settlement and advances the cursor", () =>
    Effect.gen(function* () {
      const repository = yield* PmRuntimeStateRepository;
      const projectId = ProjectId.make("project-1");

      const first = yield* repository.consumeSettlementAndAdvanceCursor({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        sequence: 10,
        consumedAt: "2026-06-14T00:00:00.000Z",
      });
      const duplicate = yield* repository.consumeSettlementAndAdvanceCursor({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        sequence: 11,
        consumedAt: "2026-06-14T00:01:00.000Z",
      });

      assert.strictEqual(first, true);
      assert.strictEqual(duplicate, false);

      const cursor = yield* repository.getCursor({ projectId });
      assert.ok(Option.isSome(cursor));
      assert.strictEqual(cursor.value.lastConsumedSequence, 11);

      const settlements = yield* repository.listConsumedSettlements({
        projectId,
        kind: "stage",
      });
      assert.deepStrictEqual(
        settlements.map((settlement) => ({
          settlementKey: settlement.settlementKey,
          status: settlement.status,
        })),
        [{ settlementKey: "thread-1::turn-1", status: "pending" }],
      );
    }),
  );

  it.effect("lists pending settlements and idempotently marks them acted", () =>
    Effect.gen(function* () {
      const repository = yield* PmRuntimeStateRepository;
      const projectId = ProjectId.make("project-pending");

      yield* repository.consumeSettlementAndAdvanceCursor({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        sequence: 10,
        consumedAt: "2026-06-14T00:00:00.000Z",
      });
      yield* repository.consumeSettlementAndAdvanceCursor({
        projectId,
        kind: "gate",
        settlementKey: "gate-1",
        sequence: 11,
        consumedAt: "2026-06-14T00:01:00.000Z",
      });

      const pendingBefore = yield* repository.listPending({ projectId });
      assert.deepStrictEqual(
        pendingBefore.map((settlement) => settlement.settlementKey),
        ["thread-1::turn-1", "gate-1"],
      );

      yield* repository.markActed({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        actedAt: "2026-06-14T00:02:00.000Z",
      });
      yield* repository.markActed({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        actedAt: "2026-06-14T00:03:00.000Z",
      });

      const pendingAfter = yield* repository.listPending({ projectId });
      assert.deepStrictEqual(
        pendingAfter.map((settlement) => settlement.settlementKey),
        ["gate-1"],
      );

      const stageSettlements = yield* repository.listConsumedSettlements({
        projectId,
        kind: "stage",
      });
      assert.strictEqual(stageSettlements[0]?.status, "acted");
    }),
  );

  it.effect("does not move the cursor backwards", () =>
    Effect.gen(function* () {
      const repository = yield* PmRuntimeStateRepository;
      const projectId = ProjectId.make("project-2");

      yield* repository.consumeSettlementAndAdvanceCursor({
        projectId,
        kind: "gate",
        settlementKey: "gate-1",
        sequence: 15,
        consumedAt: "2026-06-14T00:00:00.000Z",
      });
      yield* repository.consumeSettlementAndAdvanceCursor({
        projectId,
        kind: "gate",
        settlementKey: "gate-2",
        sequence: 12,
        consumedAt: "2026-06-14T00:01:00.000Z",
      });

      const cursor = yield* repository.getCursor({ projectId });
      assert.ok(Option.isSome(cursor));
      assert.strictEqual(cursor.value.lastConsumedSequence, 15);
    }),
  );

  it.effect("durably holds and releases lifecycle delivery recovery state", () =>
    Effect.gen(function* () {
      const repository = yield* PmRuntimeStateRepository;
      const projectId = ProjectId.make("project-recovery");
      yield* repository.consumeSettlementAndAdvanceCursor({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        sequence: 10,
        consumedAt: "2026-06-14T00:00:00.000Z",
      });

      const firstHoldEpisode = yield* repository.recordDeliveryFailure({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        retryAttempts: 1,
        holdReason: "auth",
        nextRetryAt: null,
      });
      const held = yield* repository.listPending({ projectId });
      assert.deepStrictEqual(
        held.map((row) => ({
          retryAttempts: row.retryAttempts,
          holdReason: row.holdReason,
          nextRetryAt: row.nextRetryAt,
          deliveryEpisode: row.deliveryEpisode,
        })),
        [{ retryAttempts: 1, holdReason: "auth", nextRetryAt: null, deliveryEpisode: 1 }],
      );
      assert.strictEqual(firstHoldEpisode, 1);

      yield* repository.releaseDeliveryHolds({ projectId, reasons: ["auth"] });
      const released = yield* repository.listPending({ projectId });
      assert.deepStrictEqual(
        released.map((row) => ({
          retryAttempts: row.retryAttempts,
          holdReason: row.holdReason,
          nextRetryAt: row.nextRetryAt,
          deliveryEpisode: row.deliveryEpisode,
        })),
        [{ retryAttempts: 0, holdReason: null, nextRetryAt: null, deliveryEpisode: 1 }],
      );

      const secondHoldEpisode = yield* repository.recordDeliveryFailure({
        projectId,
        kind: "stage",
        settlementKey: "thread-1::turn-1",
        retryAttempts: 1,
        holdReason: "auth",
        nextRetryAt: null,
      });
      assert.strictEqual(secondHoldEpisode, 2);
      yield* repository.resetDeliveryRecovery({ projectId });
      const manuallyReset = yield* repository.listPending({ projectId });
      assert.deepStrictEqual(
        manuallyReset.map((row) => ({
          retryAttempts: row.retryAttempts,
          holdReason: row.holdReason,
          nextRetryAt: row.nextRetryAt,
          deliveryEpisode: row.deliveryEpisode,
        })),
        [{ retryAttempts: 0, holdReason: null, nextRetryAt: null, deliveryEpisode: 2 }],
      );
    }),
  );
});
