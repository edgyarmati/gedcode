import { OrchestratorPlaybookFrontmatter } from "@t3tools/contracts";
import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";

import { defaultTaskTypeRegistry } from "./TaskTypeRegistry.ts";

export type PlaybookSourceEntry = {
  readonly text: string;
  readonly filePath: string;
};

export type PlaybookSource = {
  readonly id: string;
  readonly resolve: (taskTypeId: string) => PlaybookSourceEntry | undefined;
};

export type ResolvedPlaybook = {
  readonly taskTypeId: string;
  readonly sourceId: string;
  readonly playbookVersion: string;
  readonly frontmatter: OrchestratorPlaybookFrontmatter;
  readonly body: string;
  readonly text: string;
  readonly skill: Skill;
};

export type Skill = {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly filePath: string;
  readonly disableModelInvocation?: boolean;
};

const HASH_HEX_PREFIX_LENGTH = 12;
const decodeFrontmatter = Schema.decodeUnknownSync(OrchestratorPlaybookFrontmatter);

export const builtInPlaybookSource: PlaybookSource = {
  id: "builtin",
  resolve: (taskTypeId) => defaultTaskTypeRegistry.get(taskTypeId)?.playbook,
};

export class PlaybookLoader {
  readonly #sources: ReadonlyArray<PlaybookSource>;

  constructor(sources: ReadonlyArray<PlaybookSource> = [builtInPlaybookSource]) {
    this.#sources = [...sources];
  }

  resolve(taskTypeId: string): ResolvedPlaybook | undefined {
    for (const source of this.#sources) {
      let entry: PlaybookSourceEntry | undefined;
      try {
        entry = source.resolve(taskTypeId);
      } catch {
        continue;
      }
      if (entry === undefined) continue;

      try {
        return resolvePlaybookEntry(taskTypeId, source.id, entry);
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

export const defaultPlaybookLoader = new PlaybookLoader();

export const resolvePlaybookEntry = (
  taskTypeId: string,
  sourceId: string,
  entry: PlaybookSourceEntry,
): ResolvedPlaybook => {
  const parsed = parsePlaybookMarkdown(entry.text);
  const frontmatter = decodeFrontmatter(parsed.frontmatter);
  const hash = createHash("sha256").update(entry.text, "utf8").digest("hex");
  const playbookVersion = `${sourceId}:${hash.slice(0, HASH_HEX_PREFIX_LENGTH)}`;

  return {
    taskTypeId,
    sourceId,
    playbookVersion,
    frontmatter,
    body: parsed.body,
    text: entry.text,
    skill: {
      name: frontmatter.name,
      description: frontmatter.description,
      content: parsed.body,
      filePath: entry.filePath,
    },
  };
};

const parsePlaybookMarkdown = (
  text: string,
): { readonly frontmatter: Record<string, unknown>; readonly body: string } => {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const frontmatterText = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 4).trim();
  return { frontmatter: parseFlatYamlFrontmatter(frontmatterText), body };
};

const parseFlatYamlFrontmatter = (frontmatterText: string): Record<string, unknown> => {
  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    frontmatter[key] = parseYamlStringScalar(rawValue);
  }
  return frontmatter;
};

const parseYamlStringScalar = (value: string): string => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
};
