.PHONY: all setup run test clean

all: setup

setup:
	npm ci
	npm run compile

run:
	@if [ -z "$$AI_API_KEY" ]; then \
		echo "ERROR: AI_API_KEY environment variable is not set."; \
		echo "Please run: export AI_API_KEY=\"<your-api-key>\""; \
		exit 1; \
	fi
	@if [ ! -f "dist/extension.js" ] || [ ! -f "dist/webview.js" ]; then \
		echo "Build artifacts missing. Compiling extension..."; \
		npm run compile; \
	fi
	@CODE_CMD=$$(command -v code 2>/dev/null || command -v cursor 2>/dev/null || command -v codium 2>/dev/null || true); \
	if [ -z "$$CODE_CMD" ] && [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then \
		CODE_CMD="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"; \
	fi; \
	if [ -z "$$CODE_CMD" ]; then \
		echo "ERROR: VS Code CLI ('code', 'cursor', or 'codium') not found on PATH."; \
		echo "To make 'code' available, open VS Code, open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P),"; \
		echo "and run: Shell Command: Install 'code' command in PATH."; \
		exit 1; \
	fi; \
	echo "Launching Axiom in Extension Development Host via $$CODE_CMD..."; \
	"$$CODE_CMD" --extensionDevelopmentPath="$(CURDIR)" "$(CURDIR)"

test:
	npm run lint
	npm test

clean:
	rm -rf dist out
