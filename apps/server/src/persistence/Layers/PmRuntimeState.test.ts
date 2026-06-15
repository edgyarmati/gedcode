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
        settlements.map((settlement) => settlement.settlementKey),
        ["thread-1::turn-1"],
      );
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
});
