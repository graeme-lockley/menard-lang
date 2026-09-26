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
RUNTIME_LIB_SRCS := $(RUNTIME_DIR)/src/alloc.c $(RUNTIME_DIR)/src/panic.c $(RUNTIME_DIR)/src/print.c $(RUNTIME_DIR)/src/shadow.c

BUILD_DIR := build

.PHONY: test typecheck ci runtime-smoke runtime-clean hello-native ret-native

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
# result. `src/emit/lower.mnd` lowers hello.mnd's `(defn main -> Int 0)`
# to a real untag/trunc/`ret` sequence over the tagged literal `0`, so
# this still returns 0.
#
# Linked against the runtime (RUNTIME_LIB_SRCS), not the bare `.bc`: slice
# 2C's oracle (tests/phase2/oracle.test.ts) links the same way, and this
# target is meant to match it, even though this particular module does not
# yet call into the runtime.
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
