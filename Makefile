.PHONY: setup start stop restart status log metrics clean build check test coverage test-browser e2e typecheck lint bench test-package verify dev pack
setup:
	npm ci
	npx playwright install --with-deps chromium
# A library: no long-running service. `make dev` serves the browser example in the foreground.
start stop restart status log: ; @echo "∅ $@: no service"
# Measured bundle sizes per public entry, written by the build's last step.
metrics: build
	@cat dist/stats.json
clean:
	npm run clean
build:
	npm run build
check:
	npm run check
test:
	npm test
coverage:
	npm run test:coverage
test-browser:
	npm run test:browser
# Builds first: the browser specs load dist/, and test-package and verify consume the packed artifact.
e2e: build
	npm run test:browser
	npm run test:package
	npm run verify
typecheck:
	npm run typecheck
lint:
	npm run lint
bench:
	npm run bench
test-package:
	npm run test:package
# What CI runs; cheapest first. typecheck also runs the public API type tests in tests/types.
verify: lint typecheck test coverage e2e
dev:
	npm run dev
pack: check
	@echo 'Verified npm tarball is in artifacts/'
