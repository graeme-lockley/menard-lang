# CC ?= clang has no effect against GNU Make's own built-in default (CC=cc,
# origin "default"), so pin explicitly here — this still yields to an
# environment or command-line CC (`make CC=gcc ...`), just not to make's
# implicit-rules default. `clang` is looked up on PATH when the recipe
# runs, per the project's toolchain pin.
ifeq ($(origin CC),default)
CC := clang
endif
CFLAGS ?= -std=c11 -Wall -Wextra -O1
RUNTIME_DIR := runtime
RUNTIME_BUILD := $(RUNTIME_DIR)/build
RUNTIME_SRCS := $(RUNTIME_DIR)/src/alloc.c $(RUNTIME_DIR)/src/panic.c $(RUNTIME_DIR)/src/smoke_main.c

# The runtime a *compiled Menard program* links against — alloc + panic +
# the fd-1 print helpers + the (stub) shadow-stack rooting ABI. Deliberately
# excludes smoke_main.c: that file defines its own `main`, which would
# collide with the `main` an emitted `.bc` module already defines.
RUNTIME_LIB_SRCS := $(RUNTIME_DIR)/src/alloc.c $(RUNTIME_DIR)/src/panic.c $(RUNTIME_DIR)/src/print.c $(RUNTIME_DIR)/src/shadow.c $(RUNTIME_DIR)/src/variants.c $(RUNTIME_DIR)/src/str.c $(RUNTIME_DIR)/src/map.c $(RUNTIME_DIR)/src/closure.c $(RUNTIME_DIR)/src/io.c

BUILD_DIR := build

.PHONY: test typecheck ci runtime-smoke runtime-clean hello-native ret-native check-fixed-point

test:
	cd host && bun test ../tests

typecheck:
	cd host && bunx tsc --noEmit -p tsconfig.json

ci: typecheck test

# Phase 2 runtime: build the leaking bump allocator plus a standalone smoke
# `main` (runtime does not yet get `main` from a compiled Menard program —
# see runtime/README.md), link with $(CC), and run it.
runtime-smoke:
	@mkdir -p $(RUNTIME_BUILD)
	$(CC) $(CFLAGS) -I$(RUNTIME_DIR)/include $(RUNTIME_SRCS) -o $(RUNTIME_BUILD)/smoke
	$(RUNTIME_BUILD)/smoke

runtime-clean:
	rm -rf $(RUNTIME_BUILD)

# Phase 2, Goal B: emit a bitcode module for hello.mnd with the (stage0)
# compiler, link it with $(CC) — never `llvm-as` (ADR 40) — and run the
# result. `src/emit/lower.mnd` lowers hello.mnd's standalone top-level
# `(println "Hello, world!")` into a real `mn_write_stdout` call
# prepended to `main`'s body, then its `(defn main -> Int 0)` to a real
# untag/trunc/`ret` sequence over the tagged literal `0` — so this now
# prints "Hello, world!" (via the runtime's fd-1 print helpers) and still
# returns 0.
#
# Linked against the runtime (RUNTIME_LIB_SRCS), not the bare `.bc`: slice
# 2C's oracle (tests/phase2/oracle.test.ts) links the same way, and this
# module now genuinely needs it — `mn_write_stdout`/`mn_print_i64`/
# `mn_write_stderr` are undefined without it.
hello-native:
	@mkdir -p $(BUILD_DIR)
	bun run host/src/cli/menard.ts run src/main.mnd -- emit hello.mnd $(BUILD_DIR)/hello.bc
	$(CC) $(CFLAGS) -I$(RUNTIME_DIR)/include $(BUILD_DIR)/hello.bc $(RUNTIME_LIB_SRCS) -o $(BUILD_DIR)/hello
	$(BUILD_DIR)/hello; echo $$?

# Same as hello-native, but against tests/phase2/oracle/ret41.mnd, whose
# `main` is a nonzero Int literal — proving `src/emit/lower.mnd` /
# `src/emit/bc-writer.mnd` emit a real untag/trunc/`ret` sequence for
# `N != 0`, not just the tagged literal `0`. Expect `41`. Linked against
# the runtime, same rationale as hello-native above.
ret-native:
	@mkdir -p $(BUILD_DIR)
	bun run host/src/cli/menard.ts run src/main.mnd -- emit tests/phase2/oracle/ret41.mnd $(BUILD_DIR)/ret41.bc
	$(CC) $(CFLAGS) -I$(RUNTIME_DIR)/include $(BUILD_DIR)/ret41.bc $(RUNTIME_LIB_SRCS) -o $(BUILD_DIR)/ret41
	$(BUILD_DIR)/ret41; echo $$?

# Phase 3 slice H — fixed-point gate: stage0 emit of src/main.mnd
# → bc0; link stage1; stage1 emit → bc1; cmp bc0 bc1.
# Private-name uniquify on flatten is in; full `src/` emit still blocked on
# first-class top-level fn/ctor values (see examples/README.md). This recipe
# fails at stage0 emit until that lands; when emit+link+cmp succeeds, it is
# the agreement gate.
check-fixed-point:
	@mkdir -p $(BUILD_DIR)/fp
	@echo "==> stage0 emit src/main.mnd → bc0"
	@bun run host/src/cli/menard.ts run src/main.mnd -- emit src/main.mnd $(BUILD_DIR)/fp/bc0.bc \
		|| (echo "check-fixed-point: stage0 emit of src/main.mnd failed (slice H: need top-level-as-closure / trampolines; see examples/README.md)" >&2; exit 1)
	@echo "==> link stage1"
	$(CC) $(CFLAGS) -I$(RUNTIME_DIR)/include $(BUILD_DIR)/fp/bc0.bc $(RUNTIME_LIB_SRCS) -o $(BUILD_DIR)/fp/stage1
	@echo "==> stage1 emit src/main.mnd → bc1"
	$(BUILD_DIR)/fp/stage1 emit src/main.mnd $(BUILD_DIR)/fp/bc1.bc
	@echo "==> cmp bc0 bc1"
	cmp $(BUILD_DIR)/fp/bc0.bc $(BUILD_DIR)/fp/bc1.bc && echo "bc0 == bc1 OK"
