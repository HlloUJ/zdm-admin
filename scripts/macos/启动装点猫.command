#!/bin/zsh
set -euo pipefail

launchctl kickstart -k gui/501/com.zdm.admin.dev
open http://127.0.0.1:5173
