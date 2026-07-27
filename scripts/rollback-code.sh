#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/rollback-code.sh <git-tag-or-commit>" >&2
  exit 1
fi

TARGET="$1"

git fetch --tags
git switch --detach "${TARGET}"

echo "Checked out ${TARGET} in detached HEAD mode. Create a hotfix branch before making changes."
