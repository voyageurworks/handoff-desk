#!/bin/sh
# The README quick start, run non-interactively. Works in sh, bash and zsh (CI runs it under bash and zsh):
#   bash scripts/quickstart-smoke.sh      zsh scripts/quickstart-smoke.sh
# Needs a built checkout (npm run build). Uses a throwaway HOME with a space in its path.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
mkdir -p "$WORK/home dir"
HOME="$WORK/home dir"
USERPROFILE=$(cd "$HOME" && pwd -W 2>/dev/null || pwd) # Windows Node reads USERPROFILE; harmless elsewhere
export HOME USERPROFILE

# Step 2: the tilde is quoted, so the shell does not expand it and handoff-desk has to.
node "$ROOT/dist/main.js" init '~/handoff-demo'
test -d "$HOME/handoff-demo/Desk"
test ! -e "$ROOT/~"

# Step 4: the stand-in agent, in the background.
HANDOFF_DIR="$HOME/handoff-demo" node "$ROOT/dist/main.js" stand-in &
STAND_IN=$!
trap 'kill $STAND_IN 2>/dev/null || true' EXIT INT TERM

# Step 5: a client hands over a question and reads the answer. Its config also uses a quoted tilde.
HANDOFF_DIR='~/handoff-demo' node "$ROOT/scripts/smoke-client.mjs" "$ROOT/dist/main.js"

grep -q "status: done" "$HOME/handoff-demo/Desk/"*.md
echo "quick start ok"
