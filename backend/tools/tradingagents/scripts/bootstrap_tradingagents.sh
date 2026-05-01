#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_HOME="${TRADINGAGENTS_SKILL_HOME:-$HOME/.cache/tradingagents-skill}"
UPSTREAM_REPO="${TRADINGAGENTS_UPSTREAM_REPO:-https://github.com/TauricResearch/TradingAgents.git}"
UPSTREAM_REF="${TRADINGAGENTS_UPSTREAM_REF:-v0.2.3}"
UPSTREAM_BASE="$SKILL_HOME/upstream"
UPSTREAM_DIR="$UPSTREAM_BASE/TradingAgents"
VENV_DIR="$SKILL_HOME/venv"
INSTALLED_REF_FILE="$SKILL_HOME/.installed-ref"
FORCE_INSTALL=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE_INSTALL=1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required for TradingAgents bootstrap." >&2
  exit 1
fi

PYTHON_BIN="${TRADINGAGENTS_BOOTSTRAP_PYTHON:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$(command -v "$candidate")"
      break
    fi
  done
fi
if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
  echo "Python >=3.10 is required for TradingAgents bootstrap." >&2
  exit 1
fi
"$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Python >=3.10 is required for TradingAgents bootstrap.")
PY

mkdir -p "$UPSTREAM_BASE" "$SKILL_HOME/results" "$SKILL_HOME/cache"

if [[ ! -d "$UPSTREAM_DIR/.git" ]]; then
  git clone "$UPSTREAM_REPO" "$UPSTREAM_DIR"
fi

git -C "$UPSTREAM_DIR" fetch --tags origin
git -C "$UPSTREAM_DIR" checkout --force "$UPSTREAM_REF"

NEED_INSTALL=0
if [[ "$FORCE_INSTALL" -eq 1 ]]; then
  NEED_INSTALL=1
elif [[ ! -x "$VENV_DIR/bin/python" ]]; then
  NEED_INSTALL=1
elif [[ ! -f "$INSTALLED_REF_FILE" ]]; then
  NEED_INSTALL=1
elif [[ "$(cat "$INSTALLED_REF_FILE")" != "$UPSTREAM_REF" ]]; then
  NEED_INSTALL=1
fi

if [[ "$NEED_INSTALL" -eq 1 ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install "$UPSTREAM_DIR"
  printf '%s\n' "$UPSTREAM_REF" > "$INSTALLED_REF_FILE"
fi

cat <<EOF
Skill directory: $SKILL_DIR
Skill home: $SKILL_HOME
Upstream dir: $UPSTREAM_DIR
Virtualenv python: $VENV_DIR/bin/python
Pinned ref: $UPSTREAM_REF
EOF
