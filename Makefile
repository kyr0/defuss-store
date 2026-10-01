.PHONY: setup clean build check test test-browser e2e typecheck lint bench test-package verify dev pack
setup:
	npm ci
	npx playwright install chromium
clean:
	npm run clean
build:
	npm run build
check:
	npm run check
test:
	npm test
test-browser:
	npm run test:browser
e2e: test-browser
typecheck:
	npm run typecheck
lint:
	npm run lint
bench:
	npm run bench
test-package:
	npm run test:package
verify:
	npm run verify
dev:
	npm run dev
pack: check
	@echo 'Verified npm tarball is in artifacts/'
