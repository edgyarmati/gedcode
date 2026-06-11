import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  resolveDesktopRuntimeDependencies,
  resolveBuildOptions,
  resolveDesktopBuildIconAssets,
  resolveDesktopProductName,
  resolveDesktopUpdateChannel,
  resolveMockUpdateServerPort,
  resolveMockUpdateServerUrl,
  resolveMissingMacSigningEnvironment,
  createBuildConfig,
  ELECTRON_BUILDER_PACKAGE,
} from "./build-desktop-artifact.ts";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

it.layer(NodeServices.layer)("build-desktop-artifact", (it) => {
  it("resolves the dedicated nightly updater channel from nightly versions", () => {
    assert.equal(resolveDesktopUpdateChannel("0.0.17-nightly.20260413.42"), "nightly");
    assert.equal(resolveDesktopUpdateChannel("0.0.18-dev.1"), "latest");
    assert.equal(resolveDesktopUpdateChannel("0.0.17"), "latest");
  });

  it("switches desktop packaging product names for alternate tracks", () => {
    assert.equal(resolveDesktopProductName("0.0.17"), "GedCode");
    assert.equal(resolveDesktopProductName("0.0.18-dev.1"), "GedCode (Dev)");
    assert.equal(resolveDesktopProductName("0.0.17-nightly.20260413.42"), "GedCode (Nightly)");
  });

  it("switches desktop packaging icons for alternate tracks", () => {
    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17"), {
      macIconPng: BRAND_ASSET_PATHS.productionMacIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.productionLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    });

    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.18-dev.1"), {
      macIconPng: BRAND_ASSET_PATHS.developmentDesktopIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.developmentDesktopIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    });

    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17-nightly.20260413.42"), {
      macIconPng: BRAND_ASSET_PATHS.nightlyMacIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    });
  });

  it("omits bundled workspace packages from staged desktop dependencies", () => {
    assert.deepStrictEqual(
      resolveDesktopRuntimeDependencies(
        {
          "@effect/platform-node": "catalog:",
          "@t3tools/contracts": "workspace:*",
          "@t3tools/shared": "workspace:*",
          "@t3tools/ssh": "workspace:*",
          "@t3tools/tailscale": "workspace:*",
          effect: "catalog:",
          electron: "41.5.0",
        },
        {
          "@effect/platform-node": "4.0.0-beta.59",
          effect: "4.0.0-beta.59",
        },
      ),
      {
        "@effect/platform-node": "4.0.0-beta.59",
        effect: "4.0.0-beta.59",
      },
    );
  });

  it("falls back to the default mock update port when the configured port is blank", () => {
    assert.equal(resolveMockUpdateServerUrl(undefined), "http://localhost:3000");
    assert.equal(resolveMockUpdateServerUrl(4123), "http://localhost:4123");
  });

  it.effect("uses GedCode identifiers in desktop build config", () =>
    Effect.gen(function* () {
      const buildConfig = yield* createBuildConfig(
        "linux",
        "AppImage",
        "0.0.17",
        false,
        false,
        undefined,
      );

      assert.equal(buildConfig.appId, "com.t3tools.gedcode");
      assert.equal(buildConfig.productName, "GedCode");
      assert.equal(buildConfig.artifactName, "GedCode-${version}-${arch}.${ext}");
      assert.deepStrictEqual(buildConfig.linux, {
        target: ["AppImage"],
        executableName: "gedcode",
        icon: "icon.png",
        category: "Development",
        desktop: {
          entry: {
            StartupWMClass: "gedcode",
          },
        },
      });
    }),
  );

  it.effect("uses dev identifiers in desktop build config for dev versions", () =>
    Effect.gen(function* () {
      const previousRepository = process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY;
      process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY = "edgyarmati/gedcode";
      try {
        const buildConfig = yield* createBuildConfig(
          "linux",
          "AppImage",
          "0.0.18-dev.1",
          false,
          false,
          undefined,
        );

        assert.equal(buildConfig.appId, "com.t3tools.gedcode.dev");
        assert.equal(buildConfig.productName, "GedCode (Dev)");
        assert.equal(buildConfig.artifactName, "GedCode-Dev-${version}-${arch}.${ext}");
        assert.equal(buildConfig.publish, undefined);
        assert.deepStrictEqual(buildConfig.linux, {
          target: ["AppImage"],
          executableName: "gedcode-dev",
          icon: "icon.png",
          category: "Development",
          desktop: {
            entry: {
              StartupWMClass: "gedcode-dev",
            },
          },
        });
      } finally {
        if (previousRepository === undefined) {
          delete process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY;
        } else {
          process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY = previousRepository;
        }
      }
    }),
  );

  it.effect("configures hardened runtime for signed macOS builds", () =>
    Effect.gen(function* () {
      const buildConfig = yield* createBuildConfig("mac", "dmg", "0.0.17", true, false, undefined);

      assert.equal(buildConfig.forceCodeSigning, true);
      assert.deepStrictEqual(buildConfig.mac, {
        target: ["dmg", "zip"],
        icon: "icon.icns",
        category: "public.app-category.developer-tools",
        hardenedRuntime: true,
        gatekeeperAssess: false,
        notarize: true,
        entitlements: "entitlements.mac.plist",
        entitlementsInherit: "entitlements.mac.plist",
      });
    }),
  );

  it.effect("keeps unsigned local macOS build config close to the ad-hoc fallback path", () =>
    Effect.gen(function* () {
      const buildConfig = yield* createBuildConfig("mac", "dmg", "0.0.17", false, false, undefined);

      assert.equal(buildConfig.forceCodeSigning, false);
      assert.deepStrictEqual(buildConfig.mac, {
        target: ["dmg", "zip"],
        icon: "icon.icns",
        category: "public.app-category.developer-tools",
      });
    }),
  );

  it("detects missing macOS signing environment values", () => {
    assert.deepStrictEqual(
      resolveMissingMacSigningEnvironment({
        CSC_LINK: "certificate",
        CSC_KEY_PASSWORD: "",
        APPLE_API_KEY: "key",
        APPLE_API_KEY_ID: "key-id",
        APPLE_API_ISSUER: "issuer",
      }),
      ["CSC_KEY_PASSWORD"],
    );
  });

  it("pins electron-builder to the ad-hoc signing compatible version", () => {
    assert.equal(ELECTRON_BUILDER_PACKAGE, "electron-builder@26.8.1");
  });

  it.effect("normalizes mock update server ports from env-style strings", () =>
    Effect.gen(function* () {
      assert.equal(yield* resolveMockUpdateServerPort(undefined), undefined);
      assert.equal(yield* resolveMockUpdateServerPort(""), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("   "), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("4123"), 4123);
    }),
  );

  it.effect("rejects non-numeric or out-of-range mock update ports", () =>
    Effect.gen(function* () {
      const invalidPorts = ["abc", "12.5", "0", "65536"];
      for (const port of invalidPorts) {
        const exit = yield* Effect.exit(resolveMockUpdateServerPort(port));
        assert.equal(exit._tag, "Failure");
      }
    }),
  );

  it.effect("preserves explicit false boolean flags over true env defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveBuildOptions({
        platform: Option.some("mac"),
        target: Option.none(),
        arch: Option.some("arm64"),
        buildVersion: Option.none(),
        outputDir: Option.some("release-test"),
        skipBuild: Option.some(false),
        keepStage: Option.some(false),
        signed: Option.some(false),
        verbose: Option.some(false),
        mockUpdates: Option.some(false),
        mockUpdateServerPort: Option.none(),
      }).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                T3CODE_DESKTOP_SKIP_BUILD: "true",
                T3CODE_DESKTOP_KEEP_STAGE: "true",
                T3CODE_DESKTOP_SIGNED: "true",
                T3CODE_DESKTOP_VERBOSE: "true",
                T3CODE_DESKTOP_MOCK_UPDATES: "true",
              },
            }),
          ),
        ),
      );

      assert.equal(resolved.skipBuild, false);
      assert.equal(resolved.keepStage, false);
      assert.equal(resolved.signed, false);
      assert.equal(resolved.verbose, false);
      assert.equal(resolved.mockUpdates, false);
    }),
  );
});
