.PHONY: all setup compile run test clean

all: setup

setup:
	npm ci
	npm run compile

compile:
	npm run compile

run: compile
	@REPO="$(REPO)" MODEL="$(MODEL)" MAX_TOKENS="$(MAX_TOKENS)" ./scripts/launch-tui.sh "$(TASK)"

test:
	npm run lint
	npm test

clean:
	rm -rf dist out
