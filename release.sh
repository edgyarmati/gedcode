#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./release.sh <stable|nightly> <major|minor|patch> [--dry-run]

Run local release gates and dispatch the GitHub Release workflow.

Requirements:
  - clean git worktree
  - CHANGELOG.md contains a section for the resolved version
  - gh CLI is installed and authenticated
  - bun fmt, bun lint, bun typecheck, bun run test, and bun run release:smoke pass

Examples:
  ./release.sh stable patch
  ./release.sh nightly minor
  ./release.sh stable minor --dry-run
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

channel="${1:-}"
bump="${2:-}"
dry_run=false

if [[ $# -ge 2 ]]; then
  shift 2
fi

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    *)
      echo "Unexpected argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$channel" in
  stable | nightly) ;;
  *)
    echo "Release channel is required and must be stable or nightly." >&2
    usage >&2
    exit 2
    ;;
esac

case "$bump" in
  major | minor | patch) ;;
  *)
    echo "Version bump is required and must be major, minor, or patch." >&2
    usage >&2
    exit 2
    ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Git worktree must be clean before releasing." >&2
  git status --short >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required to dispatch the release workflow." >&2
  exit 1
fi

origin_url="$(git remote get-url origin)"
release_repository="$(
  node -e '
    const url = process.argv[1];
    const httpsMatch = /^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
    const sshMatch = /^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
    const match = httpsMatch ?? sshMatch;
    if (!match) {
      process.exit(1);
    }
    console.log(match[1]);
  ' "$origin_url"
)" || {
  echo "Could not resolve GitHub repository from origin remote: $origin_url" >&2
  exit 1
}

version="$(
  node scripts/resolve-release-version.ts \
    --channel "$channel" \
    --bump "$bump"
)"

if [[ ! -f CHANGELOG.md ]]; then
  echo "CHANGELOG.md is required before releasing." >&2
  exit 1
fi

if ! grep -Eq "^##[[:space:]]+v?${version//./\\.}([[:space:]]|$)" CHANGELOG.md; then
  echo "CHANGELOG.md must contain a section for $version before releasing." >&2
  exit 1
fi

echo "Preparing GedCode release"
echo "  channel: $channel"
echo "  bump:    $bump"
echo "  version: $version"
echo "  repo:    $release_repository"

bun fmt
bun lint
bun typecheck
bun run test
bun run release:smoke

if [[ "$dry_run" == true ]]; then
  echo "Dry run complete. Would dispatch .github/workflows/release.yml with version=$version"
  exit 0
fi

gh workflow run release.yml -R "$release_repository" --ref main -f version="$version"
echo "Dispatched release workflow for $version."
