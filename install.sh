#!/usr/bin/env bash
# Install the stride Claude Code skill into ~/.claude/skills/stride.
# Usage: ./install.sh [--dry-run]
set -euo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${HOME}/.claude/skills/stride"

echo "skill target: ${DEST}"

if [ "$DRY" = "1" ]; then
  exit 0
fi

mkdir -p "$DEST"
cp "$SRC/skill/SKILL.md" "$DEST/SKILL.md"
echo "installed stride skill to ${DEST}"
echo "note: install the CLI separately with 'npm install -g stride-harness' or 'npm link'."
