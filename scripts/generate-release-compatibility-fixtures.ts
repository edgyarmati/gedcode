// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

/**
 * Regenerates immutable upgrade fixtures from published GedCode tags.
 *
 * Each tag is checked out in an isolated temporary worktree, installs the
 * dependencies recorded by that tag, and executes that tag's migration/store
 * implementation. Current source code is never used to construct historical
 * artifacts. The generated manifest records tag commits, source-tree/blob
 * identities, and SHA-256 checksums for review and test-time verification.
 *
 * Run from any directory:
 *   node scripts/generate-release-compatibility-fixtures.ts
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

interface DatabaseFixtureDefinition {
  readonly id: string;
  readonly tag: string;
  readonly migrationId: number;
  readonly releases: ReadonlyArray<string>;
}

interface BrowserCaptureDefinition {
  readonly tag: string;
  readonly composerId: string;
  readonly terminalId: string;
  readonly helperDismissalId?: string;
}

const PUBLISHED_GEDCODE_RELEASES = [
  "v0.1.0",
  "v0.1.1-nightly.20260610.1",
  "v0.1.1",
  "v0.1.2",
  "v0.1.3-nightly.20260614.1",
  "v0.1.3",
  "v0.2.0",
  "v0.2.1",
  "v0.2.2-nightly.20260712.1",
  "v0.3.0-nightly.20260716.1",
  "v0.3.0",
  "v0.4.0",
  "v0.4.1",
  "v0.4.2",
  "v0.4.3",
] as const;

const DATABASE_FIXTURES: ReadonlyArray<DatabaseFixtureDefinition> = [
  {
    id: "schema-32-v0.1.0",
    tag: "v0.1.0",
    migrationId: 32,
    releases: [
      "v0.1.0",
      "v0.1.1-nightly.20260610.1",
      "v0.1.1",
      "v0.1.2",
      "v0.1.3-nightly.20260614.1",
      "v0.1.3",
    ],
  },
  { id: "schema-44-v0.2.0", tag: "v0.2.0", migrationId: 44, releases: ["v0.2.0"] },
  { id: "schema-45-v0.2.1", tag: "v0.2.1", migrationId: 45, releases: ["v0.2.1"] },
  {
    id: "schema-48-v0.2.2-nightly",
    tag: "v0.2.2-nightly.20260712.1",
    migrationId: 48,
    releases: ["v0.2.2-nightly.20260712.1"],
  },
  {
    id: "schema-53-v0.3.0-nightly",
    tag: "v0.3.0-nightly.20260716.1",
    migrationId: 53,
    releases: ["v0.3.0-nightly.20260716.1"],
  },
  { id: "schema-55-v0.3.0", tag: "v0.3.0", migrationId: 55, releases: ["v0.3.0"] },
  {
    id: "schema-73-v0.4.0",
    tag: "v0.4.0",
    migrationId: 73,
    releases: ["v0.4.0", "v0.4.1", "v0.4.2"],
  },
  { id: "schema-76-v0.4.3", tag: "v0.4.3", migrationId: 76, releases: ["v0.4.3"] },
];

const HELPER_DISMISSAL_RELEASES = new Set(["v0.4.0", "v0.4.1", "v0.4.2", "v0.4.3"]);

const BROWSER_CAPTURES: ReadonlyArray<BrowserCaptureDefinition> = PUBLISHED_GEDCODE_RELEASES.map(
  (tag) => ({
    tag,
    composerId: `composer-${tag}`,
    terminalId: `terminal-${tag}`,
    ...(HELPER_DISMISSAL_RELEASES.has(tag) ? { helperDismissalId: `helper-dismissal-${tag}` } : {}),
  }),
);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverOutputDirectory = join(root, "apps/server/src/persistence/fixtures/published-releases");
const webOutputDirectory = join(root, "apps/web/src/fixtures/published-releases");
const manifestPath = join(root, "docs/release-compatibility-fixtures.json");

function run(command: string, args: ReadonlyArray<string>, cwd: string): string {
  return execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitObject(ref: string): string {
  return run("git", ["rev-parse", ref], root);
}

const databaseReleaseInventory = DATABASE_FIXTURES.flatMap((fixture) => fixture.releases);
if (
  JSON.stringify(databaseReleaseInventory) !== JSON.stringify(PUBLISHED_GEDCODE_RELEASES) ||
  new Set(databaseReleaseInventory).size !== databaseReleaseInventory.length
) {
  throw new Error("database fixture definitions must cover every GedCode release exactly once");
}

for (const fixture of DATABASE_FIXTURES) {
  const representativeTree = gitObject(`${fixture.tag}:apps/server/src/persistence/Migrations`);
  for (const release of fixture.releases) {
    const releaseTree = gitObject(`${release}:apps/server/src/persistence/Migrations`);
    if (releaseTree !== representativeTree) {
      throw new Error(
        `${release} does not share migration tree ${representativeTree} with ${fixture.tag}`,
      );
    }
  }
}

const serverGeneratorSource = `
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import { runMigrations } from "./src/persistence/Migrations.ts";
import * as NodeSqliteClient from "./src/persistence/NodeSqliteClient.ts";

const [databasePath, fixtureTag] = process.argv.slice(2);
if (!databasePath || !fixtureTag) throw new Error("database path and fixture tag are required");

await Effect.runPromise(
  Effect.scoped(runMigrations().pipe(Effect.provide(NodeSqliteClient.layer({ filename: databasePath })))),
);

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = OFF;");
database.prepare("UPDATE effect_sql_migrations SET created_at = ?").run("2026-01-01 00:00:00");
database.prepare(\`
  INSERT INTO orchestration_events (
    event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
    command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
\`).run(
  \`release-fixture-event:\${fixtureTag}\`, "thread", \`release-fixture-thread:\${fixtureTag}\`, 1,
  "release.fixture-recorded", "2026-01-01T00:00:00.000Z", null, null,
  \`release-fixture-correlation:\${fixtureTag}\`, "system",
  JSON.stringify({ fixtureTag, sentinel: "published-release-data" }),
  JSON.stringify({ fixtureTag, generatedFromTaggedTree: true }),
);
database.prepare(\`
  INSERT INTO checkpoint_diff_blobs (thread_id, from_turn_count, to_turn_count, diff, created_at)
  VALUES (?, ?, ?, ?, ?)
\`).run(
  \`release-fixture-thread:\${fixtureTag}\`, 0, 1,
  \`diff --git a/\${fixtureTag}.txt b/\${fixtureTag}.txt\\n+published release fixture\\n\`,
  "2026-01-01T00:00:00.000Z",
);
database.exec("PRAGMA foreign_keys = ON;");
database.exec("VACUUM;");
database.close();
`;

function browserGeneratorSource(includeHelperDismissal: boolean): string {
  const helperImports = includeHelperDismissal
    ? `import { HelperRunId, ProjectId } from "@t3tools/contracts";
import {
  dismissPmHelper,
  HELPER_DISMISSAL_STORAGE_KEY,
  HELPER_DISMISSAL_STORAGE_VERSION,
  useHelperDismissalStore,
} from "./src/helperDismissalStore.ts";`
    : "";
  const helperCapture = includeHelperDismissal
    ? `
dismissPmHelper(
  {
    environmentId,
    projectId: ProjectId.make("release-fixture-project"),
    helperRunId: HelperRunId.make("release-fixture-helper"),
  },
  1_767_225_600_000,
);
output.helperDismissal = {
  key: HELPER_DISMISSAL_STORAGE_KEY,
  version: HELPER_DISMISSAL_STORAGE_VERSION,
  state: useHelperDismissalStore.getState(),
};`
    : "";

  return `
import { writeFile } from "node:fs/promises";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  useComposerDraftStore,
} from "./src/composerDraftStore.ts";
import { useTerminalStateStore } from "./src/terminalStateStore.ts";
${helperImports}

const [outputPath, fixtureTag] = process.argv.slice(2);
if (!outputPath || !fixtureTag) throw new Error("output path and fixture tag are required");
const environmentId = EnvironmentId.make("release-fixture-environment");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("release-fixture-thread"));

useComposerDraftStore.getState().setPrompt(threadRef, \`published draft from \${fixtureTag}\`);
const composerOptions = useComposerDraftStore.persist.getOptions();
const output: Record<string, unknown> = {
  composer: {
    key: COMPOSER_DRAFT_STORAGE_KEY,
    version: composerOptions.version,
    state: composerOptions.partialize?.(useComposerDraftStore.getState()),
  },
};

useTerminalStateStore.getState().setTerminalOpen(threadRef, true);
useTerminalStateStore.getState().setTerminalHeight(threadRef, 321);
const terminalOptions = useTerminalStateStore.persist.getOptions();
output.terminal = {
  key: terminalOptions.name,
  version: terminalOptions.version,
  state: terminalOptions.partialize?.(useTerminalStateStore.getState()),
};
${helperCapture}

await writeFile(outputPath, \`\${JSON.stringify(output, null, 2)}\\n\`);
`;
}

mkdirSync(serverOutputDirectory, { recursive: true });
mkdirSync(webOutputDirectory, { recursive: true });
mkdirSync(dirname(manifestPath), { recursive: true });

for (const directory of [serverOutputDirectory, webOutputDirectory]) {
  for (const entry of existsSync(directory) ? readdirSync(directory) : []) {
    rmSync(join(directory, entry));
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), "gedcode-release-fixtures-"));
const databaseManifest: Array<Record<string, unknown>> = [];
const browserManifest: {
  composer: Array<Record<string, unknown>>;
  terminal: Array<Record<string, unknown>>;
  helperDismissal: Array<Record<string, unknown>>;
} = { composer: [], terminal: [], helperDismissal: [] };

const tags = [
  ...new Set([
    ...DATABASE_FIXTURES.map((fixture) => fixture.tag),
    ...BROWSER_CAPTURES.map((fixture) => fixture.tag),
  ]),
];

try {
  for (const tag of tags) {
    const worktreePath = join(tempRoot, tag.replaceAll(/[^a-zA-Z0-9.-]/gu, "-"));
    run("git", ["worktree", "add", "--detach", worktreePath, tag], root);
    try {
      run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], worktreePath);
      const commit = gitObject(`${tag}^{commit}`);
      const databaseFixture = DATABASE_FIXTURES.find((fixture) => fixture.tag === tag);
      if (databaseFixture) {
        const generatorPath = join(worktreePath, "apps/server/.generate-release-fixture.ts");
        const rawDatabasePath = join(tempRoot, `${databaseFixture.id}.sqlite`);
        writeFileSync(generatorPath, serverGeneratorSource);
        run("node", [generatorPath, rawDatabasePath, tag], worktreePath);

        const rawBytes = readFileSync(rawDatabasePath);
        const compressedBytes = gzipSync(rawBytes, { level: 9 });
        const file = `${databaseFixture.id}.sqlite.gz`;
        writeFileSync(join(serverOutputDirectory, file), compressedBytes);
        databaseManifest.push({
          ...databaseFixture,
          file,
          commit,
          migrationsTree: gitObject(`${tag}:apps/server/src/persistence/Migrations`),
          migrationsEntryBlob: gitObject(`${tag}:apps/server/src/persistence/Migrations.ts`),
          rawBytes: rawBytes.byteLength,
          rawSha256: sha256(rawBytes),
          compressedSha256: sha256(compressedBytes),
        });
      }

      const browserCapture = BROWSER_CAPTURES.find((fixture) => fixture.tag === tag);
      if (browserCapture) {
        const generatorPath = join(worktreePath, "apps/web/.generate-release-fixture.ts");
        const capturePath = join(tempRoot, `${tag}-browser.json`);
        writeFileSync(
          generatorPath,
          browserGeneratorSource(browserCapture.helperDismissalId !== undefined),
        );
        // Tagged web source uses bundler-style extensionless imports. Execute it
        // with the tag's Bun toolchain semantics instead of Node's strict ESM
        // resolver; the captured store implementation and dependencies still
        // come entirely from the isolated tagged worktree.
        run("bun", [generatorPath, capturePath, tag], join(worktreePath, "apps/web"));
        const capture = JSON.parse(readFileSync(capturePath, "utf8")) as Record<string, unknown>;

        for (const [kind, id, releases, sourcePath] of [
          ["composer", browserCapture.composerId, [tag], "apps/web/src/composerDraftStore.ts"],
          ["terminal", browserCapture.terminalId, [tag], "apps/web/src/terminalStateStore.ts"],
          [
            "helperDismissal",
            browserCapture.helperDismissalId,
            browserCapture.helperDismissalId ? [tag] : undefined,
            "apps/web/src/helperDismissalStore.ts",
          ],
        ] as const) {
          if (!id || !releases) continue;
          const payload = capture[kind];
          const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
          const file = `${id}.json`;
          writeFileSync(join(webOutputDirectory, file), bytes);
          browserManifest[kind].push({
            id,
            tag,
            releases,
            file,
            commit,
            sourceBlob: gitObject(`${tag}:${sourcePath}`),
            sha256: sha256(bytes),
          });
        }
      }
    } finally {
      run("git", ["worktree", "remove", "--force", worktreePath], root);
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const manifest = {
  schemaVersion: 1,
  generatedBy: "scripts/generate-release-compatibility-fixtures.ts",
  provenance:
    "Artifacts were generated by executing each recorded tag's own migration and Zustand store source in an isolated worktree with that tag's frozen dependencies.",
  publishedGedcodeReleases: PUBLISHED_GEDCODE_RELEASES,
  database: databaseManifest,
  browser: browserManifest,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${databaseManifest.length} database fixtures and the browser fixture manifest.`);
