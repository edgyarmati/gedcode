import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubPullRequests from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GitHubCliError extends Schema.TaggedErrorClass<GitHubCliError>()("GitHubCliError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `GitHub CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export interface GitHubCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    /** Use GitHub's HTTP cache (including ETag revalidation) when available. */
    readonly cacheTtlSeconds?: number;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createRepository: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly visibility: SourceControlRepositoryVisibility;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
    readonly draft?: boolean;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;
}

export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "gedcode/sourceControl/GitHubCli",
) {}

function errorText(error: VcsError | unknown): string {
  if (typeof error === "object" && error !== null) {
    const tag = "_tag" in error && typeof error._tag === "string" ? error._tag : "";
    const detail = "detail" in error && typeof error.detail === "string" ? error.detail : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return [tag, detail, message].filter(Boolean).join("\n");
  }

  return String(error);
}

function normalizeGitHubCliError(
  operation: "execute" | "stdout",
  error: VcsError | unknown,
): GitHubCliError {
  const text = errorText(error);
  const lower = text.toLowerCase();

  if (lower.includes("command not found: gh") || lower.includes("enoent")) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI (`gh`) is required but not available on PATH.",
      cause: error,
    });
  }

  if (
    lower.includes("authentication failed") ||
    lower.includes("not logged in") ||
    lower.includes("gh auth login") ||
    lower.includes("no oauth token")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
      cause: error,
    });
  }

  if (
    lower.includes("could not resolve to a pullrequest") ||
    lower.includes("repository.pullrequest") ||
    lower.includes("no pull requests found for branch") ||
    lower.includes("pull request not found")
  ) {
    return new GitHubCliError({
      operation,
      detail: "Pull request not found. Check the PR number or URL and try again.",
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: text,
    cause: error,
  });
}

/**
 * `gh pr view` is GraphQL-backed and has no conditional-request option. For
 * a durable PR URL we can use the REST endpoint instead, where `gh api
 * --cache` persists its HTTP cache and revalidates it with GitHub. References
 * entered by a user (for example `#42`) intentionally keep the normal view
 * path because they do not contain a repository identity.
 */
function pullRequestApiEndpoint(reference: string): string | null {
  try {
    const url = new URL(reference);
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/u.exec(url.pathname);
    if (match === null) return null;
    const [, owner, repository, number] = match;
    if (owner === undefined || repository === undefined || number === undefined) return null;
    return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${number}`;
  } catch {
    return null;
  }
}

const cachedPullRequestJq =
  "{number,title,url:.html_url,baseRefName:.base.ref,headRefName:.head.ref,state,mergedAt:.merged_at,isCrossRepository:(.head.repo.full_name != .base.repo.full_name),headRepository:(if .head.repo == null then null else {nameWithOwner:.head.repo.full_name} end),headRepositoryOwner:(if .head.repo == null then null else {login:.head.repo.owner.login} end)}";

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

function normalizeHeadRefName(headSelector: string): string {
  const trimmed = headSelector.trim();
  const ownerBranch = /^[^:]+:(.+)$/u.exec(trimmed);
  return ownerBranch?.[1]?.trim() || trimmed;
}

function parseCreatedPullRequest(input: {
  readonly stdout: string;
  readonly baseBranch: string;
  readonly headSelector: string;
  readonly title: string;
}): Effect.Effect<GitHubPullRequestSummary, GitHubCliError> {
  const url = input.stdout.match(/https?:\/\/[^\s]+/u)?.[0]?.trim();
  const numberText = url?.match(/\/pull\/(\d+)(?:\D|$)/u)?.[1];
  const number = numberText ? Number.parseInt(numberText, 10) : Number.NaN;
  if (!url || !Number.isSafeInteger(number) || number <= 0) {
    return Effect.fail(
      new GitHubCliError({
        operation: "createPullRequest",
        detail: "GitHub CLI did not return a pull request URL.",
      }),
    );
  }

  return Effect.succeed({
    number,
    title: input.title,
    url,
    baseRefName: input.baseBranch,
    headRefName: normalizeHeadRefName(input.headSelector),
    state: "open",
  });
}

/**
 * `gh repo create` prints the canonical URL of the new repository on stdout
 * (e.g. `https://github.com/owner/repo`). Reading it back here avoids a
 * follow-up `gh repo view`, which can race GitHub's GraphQL eventual
 * consistency window and falsely report the just-created repo as missing.
 */
function deriveRepositoryCloneUrlsFromCreateOutput(
  stdout: string,
  repository: string,
): GitHubRepositoryCloneUrls {
  const fallbackHost = "github.com";
  const match = stdout.match(/https?:\/\/[^\s]+/);
  if (match) {
    const cleaned = match[0].replace(/\.git$/, "");
    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2) {
        const nameWithOwner = `${segments[0]}/${segments[1]}`;
        return {
          nameWithOwner,
          url: `${parsed.origin}/${nameWithOwner}`,
          sshUrl: `git@${parsed.host}:${nameWithOwner}.git`,
        };
      }
    } catch {
      // Fall through to the input-derived defaults below.
    }
  }
  return {
    nameWithOwner: repository,
    url: `https://${fallbackHost}/${repository}`,
    sshUrl: `git@${fallbackHost}:${repository}.git`,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: "listOpenPullRequests" | "getPullRequest" | "getRepositoryCloneUrls",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

export const make = Effect.fn("makeGitHubCli")(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCliShape["execute"] = (input) =>
    process
      .run({
        operation: "GitHubCli.execute",
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((error) => normalizeGitHubCliError("execute", error)));

  return GitHubCli.of({
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "listOpenPullRequests",
                        detail: `GitHub CLI returned invalid PR list JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) => {
      const cacheEndpoint =
        input.cacheTtlSeconds === undefined ? null : pullRequestApiEndpoint(input.reference);
      return execute({
        cwd: input.cwd,
        args:
          cacheEndpoint === null
            ? [
                "pr",
                "view",
                input.reference,
                "--json",
                "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
              ]
            : [
                "api",
                "--cache",
                `${Math.max(1, Math.floor(input.cacheTtlSeconds!))}s`,
                cacheEndpoint,
                "--jq",
                cachedPullRequestJq,
              ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequest",
                    detail: `GitHub CLI returned invalid pull request JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      );
    },
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository, `--${input.visibility}`],
      }).pipe(
        Effect.map((result) =>
          deriveRepositoryCloneUrlsFromCreateOutput(result.stdout, input.repository),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          ...(input.draft === true ? ["--draft"] : []),
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(
        Effect.flatMap((result) =>
          parseCreatedPullRequest({
            stdout: result.stdout,
            baseBranch: input.baseBranch,
            headSelector: input.headSelector,
            title: input.title,
          }),
        ),
      ),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(GitHubCli, make());
