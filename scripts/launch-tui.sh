#!/bin/bash
set -e

# Verify required API key
if [ -z "$AI_API_KEY" ] && [ -z "$DEEPSEEK_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
  echo "ERROR: AI_API_KEY environment variable is not set."
  echo "Please run: export AI_API_KEY=\"<your-api-key>\""
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Always ensure build artifacts are up to date
(cd "$REPO_DIR" && npm run compile)

# Create a self-cleaning runner script for the separate terminal window
RUNNER=$(mktemp /tmp/axiom-tui-run-XXXXXX)
cat << 'EOF' > "$RUNNER"
#!/bin/bash
trap 'rm -f "$0"' EXIT INT TERM
EOF

echo "cd \"$REPO_DIR\"" >> "$RUNNER"
echo "export PATH=\"$PATH\"" >> "$RUNNER"
echo "export AI_API_KEY=\"$AI_API_KEY\"" >> "$RUNNER"

[ -n "$AI_BASE_URL" ] && echo "export AI_BASE_URL=\"$AI_BASE_URL\"" >> "$RUNNER"
[ -n "$DEEPSEEK_BASE_URL" ] && echo "export DEEPSEEK_BASE_URL=\"$DEEPSEEK_BASE_URL\"" >> "$RUNNER"
[ -n "$OPENAI_BASE_URL" ] && echo "export OPENAI_BASE_URL=\"$OPENAI_BASE_URL\"" >> "$RUNNER"
[ -n "$AI_MODEL" ] && echo "export AI_MODEL=\"$AI_MODEL\"" >> "$RUNNER"
[ -n "$MODEL_ID" ] && echo "export MODEL_ID=\"$MODEL_ID\"" >> "$RUNNER"
[ -n "$DEEPSEEK_API_KEY" ] && echo "export DEEPSEEK_API_KEY=\"$DEEPSEEK_API_KEY\"" >> "$RUNNER"
[ -n "$OPENAI_API_KEY" ] && echo "export OPENAI_API_KEY=\"$OPENAI_API_KEY\"" >> "$RUNNER"

if [ $# -gt 0 ]; then
  printf 'exec node dist/cli.js' >> "$RUNNER"
  for arg in "$@"; do
    printf ' %q' "$arg" >> "$RUNNER"
  done
  printf '\n' >> "$RUNNER"
else
  echo 'exec node dist/cli.js' >> "$RUNNER"
fi

chmod +x "$RUNNER"

# Launch in a new, independent terminal window
OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  if [ "$TERM_PROGRAM" = "iTerm.app" ] && osascript -e 'application "iTerm" is running' 2>/dev/null | grep -q true; then
    osascript << APPLESCRIPT >/dev/null 2>&1
tell application "iTerm"
  activate
  create window with default profile
  tell current session of current window
    write text "/bin/bash '$RUNNER'"
  end tell
end tell
APPLESCRIPT
  else
    osascript << APPLESCRIPT >/dev/null 2>&1
tell application "Terminal"
  activate
  do script "/bin/bash '$RUNNER'"
end tell
APPLESCRIPT
  fi
elif [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
  # Fallback for Linux environments with desktop display
  if command -v x-terminal-emulator >/dev/null 2>&1; then
    x-terminal-emulator -e "/bin/bash '$RUNNER'" &
  elif command -v gnome-terminal >/dev/null 2>&1; then
    gnome-terminal -- /bin/bash "$RUNNER" &
  elif command -v konsole >/dev/null 2>&1; then
    konsole -e /bin/bash "$RUNNER" &
  elif command -v xterm >/dev/null 2>&1; then
    xterm -e /bin/bash "$RUNNER" &
  else
    exec /bin/bash "$RUNNER"
  fi
else
  # Headless fallback: run in current shell if no GUI terminal is available
  exec /bin/bash "$RUNNER"
fi

echo "Axiom TUI launched in a new terminal window."
exit 0
