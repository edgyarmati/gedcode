// @effect-diagnostics nodeBuiltinImport:off - executes the packaging hook with stubbed cache generation and codesigning.
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

function loadHook(prepareCache: () => Promise<void>, sign: () => Promise<void>) {
  const module = { exports: undefined as unknown };
  NodeVM.runInNewContext(NodeFS.readFileSync(new URL("./afterPack.cjs", import.meta.url), "utf8"), {
    module,
    require: (id: string) => {
      if (id === "../prepare-server-compile-cache.cjs") return prepareCache;
      if (id === "electron-sparkle-updater/builder") return { adHocSignAfterPack: sign };
      throw new Error(`Unexpected hook dependency: ${id}`);
    },
  });
  return module.exports as (context: object) => Promise<void>;
}

describe("Sparkle afterPack", () => {
  const context = { electronPlatformName: "darwin", appOutDir: "/staged" };

  it("awaits cache preparation before signing the same staged app", async () => {
    const prepared = Promise.withResolvers<void>();
    const prepareCache = vi.fn(() => prepared.promise);
    const sign = vi.fn(async () => {});
    const finished = loadHook(prepareCache, sign)(context);

    expect(prepareCache).toHaveBeenCalledExactlyOnceWith(context);
    expect(sign).not.toHaveBeenCalled();
    prepared.resolve();
    await finished;
    expect(sign).toHaveBeenCalledExactlyOnceWith(context);
  });

  it("fails packaging without signing when cache preparation fails", async () => {
    const error = new Error("cache preparation failed");
    const sign = vi.fn(async () => {});
    const hook = loadHook(() => Promise.reject(error), sign);

    await expect(hook(context)).rejects.toBe(error);
    expect(sign).not.toHaveBeenCalled();
  });

  it("fails packaging when signing fails", async () => {
    const error = new Error("signing failed");
    const prepareCache = vi.fn(async () => {});
    const hook = loadHook(prepareCache, () => Promise.reject(error));

    await expect(hook(context)).rejects.toBe(error);
    expect(prepareCache).toHaveBeenCalledExactlyOnceWith(context);
  });
});
