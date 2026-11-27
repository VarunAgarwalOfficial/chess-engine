.PHONY: dev build check lint

# The page at http://localhost:8000/.
dev:
	npm start

# The engine, built to web/engine.wasm (needs Rust), and the pixel art.
build:
	npm run build:wasm
	node scripts/pixel-art.mjs

check:
	npm ci
	npm test

lint:
	npm run lint
	npm run format:check
