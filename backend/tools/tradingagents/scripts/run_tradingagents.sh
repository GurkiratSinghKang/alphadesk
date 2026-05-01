#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_HOME="${TRADINGAGENTS_SKILL_HOME:-$HOME/.cache/tradingagents-skill}"
VENV_PYTHON="$SKILL_HOME/venv/bin/python"

bash "$SKILL_DIR/scripts/bootstrap_tradingagents.sh"

if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "TradingAgents virtualenv is missing: $VENV_PYTHON" >&2
  exit 1
fi

exec "$VENV_PYTHON" "$SKILL_DIR/scripts/run_tradingagents.py" "$@"
