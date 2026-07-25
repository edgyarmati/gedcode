import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { WORKER_TRIPWIRE_HOOK_SCRIPT } from "../../orchestration/workerTripwire.ts";
import { materializeTripwireScript } from "./codexTripwireHook.ts";

it.layer(NodeServices.layer)("tripwire script materialization", (it) => {
  // `apps/server` ships as a single bundled file, so the hook script cannot be
  // shipped as a sibling asset: it is written out where Codex can execute it.
  it.effect("writes the rules script into the server-owned directory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-tripwire-hook-" });

        const scriptPath = yield* materializeTripwireScript(directory);

        assert.equal(yield* fs.readFileString(scriptPath), WORKER_TRIPWIRE_HOOK_SCRIPT);
      }),
    ),
  );

  // An upgraded server must not keep enforcing the rules its predecessor wrote.
  it.effect("replaces a script left behind by an earlier server version", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-tripwire-hook-" });
        const stale = yield* materializeTripwireScript(directory);
        yield* fs.writeFileString(stale, "process.exit(0);\n");

        const scriptPath = yield* materializeTripwireScript(directory);

        assert.equal(scriptPath, stale);
        assert.equal(yield* fs.readFileString(scriptPath), WORKER_TRIPWIRE_HOOK_SCRIPT);
      }),
    ),
  );
});
