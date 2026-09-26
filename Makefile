.PHONY: all setup run test clean

all: setup

setup:
	npm ci
	npm run compile

run:
	@./scripts/launch-tui.sh $(TASK)

test:
	npm run lint
	npm test

clean:
	rm -rf dist out
