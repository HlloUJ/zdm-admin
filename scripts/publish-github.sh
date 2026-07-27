#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/publish-github.sh <git-remote-url>" >&2
  exit 1
fi

REMOTE_URL="$1"
CURRENT_BRANCH="$(git branch --show-current)"

if [ "${CURRENT_BRANCH}" != "main" ]; then
  echo "Expected to publish from main, but current branch is '${CURRENT_BRANCH}'." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash changes before publishing." >&2
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  EXISTING_REMOTE="$(git remote get-url origin)"
  if [ "${EXISTING_REMOTE}" != "${REMOTE_URL}" ]; then
    echo "origin already points to ${EXISTING_REMOTE}" >&2
    echo "Refusing to replace it with ${REMOTE_URL}." >&2
    exit 1
  fi
else
  git remote add origin "${REMOTE_URL}"
fi

git push -u origin main
git push origin --tags

echo "Published main and tags to ${REMOTE_URL}"
