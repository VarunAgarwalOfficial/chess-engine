.PHONY: check lint

check:
	npm ci
	npm test

lint:
	npm run lint
	npm run format:check
