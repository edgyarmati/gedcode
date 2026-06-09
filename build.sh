#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./build.sh [dev|nightly|stable] [major|minor|patch] [-- <artifact args>]

Build a local desktop artifact. Defaults to: dev patch.

Examples:
  ./build.sh
  ./build.sh dev patch -- --platform mac --target dmg --arch arm64
  ./build.sh nightly minor -- --platform mac --target dmg --arch arm64
  ./build.sh stable patch -- --platform mac --target dmg --arch arm64

Any arguments after -- are passed to scripts/build-desktop-artifact.ts.
USAGE
}

channel="${1:-dev}"
if [[ $# -gt 0 ]]; then
  shift
fi

bump="${1:-patch}"
if [[ $# -gt 0 && "$1" != "--" ]]; then
  shift
fi

artifact_args=()
if [[ $# -gt 0 ]]; then
  if [[ "$1" != "--" ]]; then
    echo "Unexpected argument: $1" >&2
    usage >&2
    exit 2
  fi
  shift
  artifact_args=("$@")
fi

case "$channel" in
  dev | nightly | stable) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "Invalid channel: $channel" >&2
    usage >&2
    exit 2
    ;;
esac

case "$bump" in
  major | minor | patch) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "Invalid version bump: $bump" >&2
    usage >&2
    exit 2
    ;;
esac

version="$(
  node scripts/resolve-release-version.ts \
    --channel "$channel" \
    --bump "$bump"
)"

echo "Building GedCode desktop artifact"
echo "  channel: $channel"
echo "  bump:    $bump"
echo "  version: $version"

bun run dist:desktop:artifact -- --build-version "$version" "${artifact_args[@]}"
