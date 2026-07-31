#!/bin/zsh
set -euo pipefail

project_root='/Users/uj/Documents/Codex/装点猫/管理后台'
launchctl bootout gui/501/com.zdm.admin.dev 2>/dev/null || true
cd "$project_root"
/usr/local/bin/docker compose stop backend mysql
