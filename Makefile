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
	@if [ ! -f "dist/cli.js" ]; then \
		echo "Compiling Daxiom TUI..."; \
		npm run compile; \
	fi
	@node dist/cli.js $(TASK)

test:
	npm run lint
	npm test

clean:
	rm -rf dist out
