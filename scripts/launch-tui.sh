#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Save explicit environment variables so .env acts as a fallback rather than clobbering shell exports
_SAVED_AI_API_KEY="$AI_API_KEY"
_SAVED_OPENROUTER_API_KEY="$OPENROUTER_API_KEY"
_SAVED_NVIDIA_API_KEY="$NVIDIA_API_KEY"
_SAVED_DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"
_SAVED_OPENAI_API_KEY="$OPENAI_API_KEY"
_SAVED_MODEL="$MODEL"
_SAVED_AI_MODEL="$AI_MODEL"
_SAVED_MAX_TOKENS="$MAX_TOKENS"
_SAVED_AI_MAX_TOKENS="$AI_MAX_TOKENS"
_SAVED_BASE_URL="$BASE_URL"
_SAVED_AI_BASE_URL="$AI_BASE_URL"
_SAVED_INPUT_TOKEN_BUDGET="$INPUT_TOKEN_BUDGET"

# Load default environment variables from .env file if present
ENV_FILE="$REPO_DIR/.env"
if [ ! -f "$ENV_FILE" ] && [ -f "./.env" ]; then
  ENV_FILE="./.env"
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# Restore explicit shell environment variables
[ -n "$_SAVED_AI_API_KEY" ] && export AI_API_KEY="$_SAVED_AI_API_KEY"
[ -n "$_SAVED_OPENROUTER_API_KEY" ] && export OPENROUTER_API_KEY="$_SAVED_OPENROUTER_API_KEY"
[ -n "$_SAVED_NVIDIA_API_KEY" ] && export NVIDIA_API_KEY="$_SAVED_NVIDIA_API_KEY"
[ -n "$_SAVED_DEEPSEEK_API_KEY" ] && export DEEPSEEK_API_KEY="$_SAVED_DEEPSEEK_API_KEY"
[ -n "$_SAVED_OPENAI_API_KEY" ] && export OPENAI_API_KEY="$_SAVED_OPENAI_API_KEY"
[ -n "$_SAVED_MODEL" ] && export MODEL="$_SAVED_MODEL"
[ -n "$_SAVED_AI_MODEL" ] && export AI_MODEL="$_SAVED_AI_MODEL"
[ -n "$_SAVED_MAX_TOKENS" ] && export MAX_TOKENS="$_SAVED_MAX_TOKENS"
[ -n "$_SAVED_AI_MAX_TOKENS" ] && export AI_MAX_TOKENS="$_SAVED_AI_MAX_TOKENS"
[ -n "$_SAVED_BASE_URL" ] && export BASE_URL="$_SAVED_BASE_URL"
[ -n "$_SAVED_AI_BASE_URL" ] && export AI_BASE_URL="$_SAVED_AI_BASE_URL"
[ -n "$_SAVED_INPUT_TOKEN_BUDGET" ] && export INPUT_TOKEN_BUDGET="$_SAVED_INPUT_TOKEN_BUDGET"

# Verify required API key
if [ -z "$AI_API_KEY" ] && [ -z "$OPENROUTER_API_KEY" ] && [ -z "$DEEPSEEK_API_KEY" ] && [ -z "$OPENAI_API_KEY" ] && [ -z "$NVIDIA_API_KEY" ]; then
  echo "ERROR: OPENROUTER_API_KEY, AI_API_KEY, or NVIDIA_API_KEY environment variable is not set."
  if [ ! -f "$ENV_FILE" ]; then
    echo "Checked .env file at $ENV_FILE: file is missing."
  elif [ ! -s "$ENV_FILE" ]; then
    echo "Checked .env file at $ENV_FILE: file is empty (0 bytes)."
  else
    echo "Checked .env file at $ENV_FILE: file exists ($(wc -c < "$ENV_FILE" | tr -d ' ') bytes), but contains no active API keys."
  fi
  echo "Please run: export OPENROUTER_API_KEY=\"<your-api-key>\" (or export AI_API_KEY=\"<your-api-key>\")"
  exit 1
fi

clean_val() {
  local val="$1"
  val="${val#[\"\'“”]}"
  val="${val%[\"\'“”]}"
  echo "$val"
}
[ -n "$AI_API_KEY" ] && AI_API_KEY="$(clean_val "$AI_API_KEY")"
[ -n "$OPENROUTER_API_KEY" ] && OPENROUTER_API_KEY="$(clean_val "$OPENROUTER_API_KEY")"
[ -n "$NVIDIA_API_KEY" ] && NVIDIA_API_KEY="$(clean_val "$NVIDIA_API_KEY")"

if [ -z "$AI_API_KEY" ] && [ -n "$OPENROUTER_API_KEY" ]; then
  export AI_API_KEY="$OPENROUTER_API_KEY"
elif [ -z "$AI_API_KEY" ] && [ -n "$NVIDIA_API_KEY" ]; then
  export AI_API_KEY="$NVIDIA_API_KEY"
fi

# Always ensure build artifacts are up to date
echo "Compiling Axiom TUI..."
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
[ -n "$OPENROUTER_API_KEY" ] && echo "export OPENROUTER_API_KEY=\"$OPENROUTER_API_KEY\"" >> "$RUNNER"
[ -n "$NVIDIA_API_KEY" ] && echo "export NVIDIA_API_KEY=\"$NVIDIA_API_KEY\"" >> "$RUNNER"

[ -n "$AI_BASE_URL" ] && echo "export AI_BASE_URL=\"$AI_BASE_URL\"" >> "$RUNNER"
[ -n "$OPENROUTER_BASE_URL" ] && echo "export OPENROUTER_BASE_URL=\"$OPENROUTER_BASE_URL\"" >> "$RUNNER"
[ -n "$BASE_URL" ] && echo "export BASE_URL=\"$BASE_URL\"" >> "$RUNNER"
[ -n "$DEEPSEEK_BASE_URL" ] && echo "export DEEPSEEK_BASE_URL=\"$DEEPSEEK_BASE_URL\"" >> "$RUNNER"
[ -n "$OPENAI_BASE_URL" ] && echo "export OPENAI_BASE_URL=\"$OPENAI_BASE_URL\"" >> "$RUNNER"
[ -n "$AI_MODEL" ] && echo "export AI_MODEL=\"$AI_MODEL\"" >> "$RUNNER"
[ -n "$MODEL" ] && echo "export MODEL=\"$MODEL\"" >> "$RUNNER"
[ -n "$DEEPSEEK_API_KEY" ] && echo "export DEEPSEEK_API_KEY=\"$DEEPSEEK_API_KEY\"" >> "$RUNNER"
[ -n "$OPENAI_API_KEY" ] && echo "export OPENAI_API_KEY=\"$OPENAI_API_KEY\"" >> "$RUNNER"
[ -n "$REPO" ] && echo "export REPO=\"$REPO\"" >> "$RUNNER"
[ -n "$AXIOM_FRESH_SESSION" ] && echo "export AXIOM_FRESH_SESSION=\"$AXIOM_FRESH_SESSION\"" >> "$RUNNER"
echo "export AXIOM_AUTONOMOUS=\"${AXIOM_AUTONOMOUS:-1}\"" >> "$RUNNER"
[ -n "$AXIOM_HEADLESS" ] && echo "export AXIOM_HEADLESS=\"$AXIOM_HEADLESS\"" >> "$RUNNER"
echo "export AXIOM_SKIP_PR=\"${AXIOM_SKIP_PR:-0}\"" >> "$RUNNER"
[ -n "$AXIOM_MOCK_PR" ] && echo "export AXIOM_MOCK_PR=\"$AXIOM_MOCK_PR\"" >> "$RUNNER"
[ -n "$MAX_TOKENS" ] && echo "export MAX_TOKENS=\"$MAX_TOKENS\"" >> "$RUNNER"
[ -n "$AI_MAX_TOKENS" ] && echo "export AI_MAX_TOKENS=\"$AI_MAX_TOKENS\"" >> "$RUNNER"
[ -n "$INPUT_TOKEN_BUDGET" ] && echo "export INPUT_TOKEN_BUDGET=\"$INPUT_TOKEN_BUDGET\"" >> "$RUNNER"
[ -n "$DAXIOM_MAX_TOOL_CALLS" ] && echo "export DAXIOM_MAX_TOOL_CALLS=\"$DAXIOM_MAX_TOOL_CALLS\"" >> "$RUNNER"
[ -n "$COLORTERM" ] && echo "export COLORTERM=\"$COLORTERM\"" >> "$RUNNER"
[ -n "$TERM" ] && echo "export TERM=\"$TERM\"" >> "$RUNNER"
[ -n "$TERM_PROGRAM" ] && echo "export TERM_PROGRAM=\"$TERM_PROGRAM\"" >> "$RUNNER"
[ -n "$FORCE_COLOR" ] && echo "export FORCE_COLOR=\"$FORCE_COLOR\"" >> "$RUNNER"
echo "export AXIOM_COLOR=\"${AXIOM_COLOR:-truecolor}\"" >> "$RUNNER"

HAS_ARGS=0
for arg in "$@"; do
  if [ -n "$arg" ]; then
    HAS_ARGS=1
    break
  fi
done

if [ "$HAS_ARGS" -eq 1 ]; then
  printf 'exec node dist/cli.js' >> "$RUNNER"
  for arg in "$@"; do
    [ -n "$arg" ] && printf ' %q' "$arg" >> "$RUNNER"
  done
  printf '\n' >> "$RUNNER"
else
  echo 'exec node dist/cli.js' >> "$RUNNER"
fi

chmod +x "$RUNNER"

# Launch in a new GUI terminal window ONLY when clearly an interactive local GUI invocation:
# - stdin is a TTY ([ -t 0 ])
# - not CI ([ -z "$CI" ])
# - AXIOM_HEADLESS != 1
# - TERM_PROGRAM is present ([ -n "$TERM_PROGRAM" ])
if [ -t 0 ] && [ -z "$CI" ] && [ "$AXIOM_HEADLESS" != "1" ] && [ -n "$TERM_PROGRAM" ]; then
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
    echo "Axiom TUI launched in a new terminal window."
    exit 0
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
    echo "Axiom TUI launched in a new terminal window."
    exit 0
  else
    exec /bin/bash "$RUNNER"
  fi
else
  # Non-TTY, CI, headless (AXIOM_HEADLESS=1), or no TERM_PROGRAM: run directly attached in current process
  exec /bin/bash "$RUNNER"
fi
