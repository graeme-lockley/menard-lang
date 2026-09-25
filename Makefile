.PHONY: test typecheck ci

test:
	cd host && bun test ../tests

typecheck:
	cd host && bunx tsc --noEmit -p tsconfig.json

ci: typecheck test
