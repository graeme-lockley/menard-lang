# Menard runtime

The C11 runtime a compiled program links against. Every Menard value is one 64-bit word: a tagged immediate, or an 8-byte-aligned pointer to a heap or static object.

Allocation comes from a copying nursery. A minor collection traces the shadow stack and the remembered set, copies survivors into old space, and resets the nursery. A major mark-sweep runs only after old space crosses a growth threshold. Static objects never move. `Float` and `Str` payloads are `bytes` objects, so the collector does not scan them as slots.

`MENARD_GC_STRESS` collects on every allocation. `MENARD_HEAP_VERIFY` checks roots and layout after each collection.

## What links

`make` links these, from the Makefile's `RUNTIME_LIB_SRCS`:

| Path | Role |
| --- | --- |
| `include/menard.h` | `MnWord`, the empty word, the `Int` tag, shapes, layout kinds, the shadow stack |
| `src/alloc.c` | `mn_alloc` |
| `src/gc.c` | Nursery copy, old-space mark-sweep |
| `src/shadow.c` | Shadow-stack roots |
| `src/panic.c` | `mn_panic`: write to fd 2, then `_exit(1)` |
| `src/print.c` | `print` and `println` on fd 1 |
| `src/variants.c` | Records, variants, lists |
| `src/str.c` | Strings and `StringBuffer` |
| `src/map.c` | Persistent maps. `mn_map_set` takes the map, then the key, then the value |
| `src/closure.c` | Heap closures |
| `src/io.c` | Files, the environment, and `posix_spawn` |
| `src/equal.c` | `=`, `compare`, and `show` |

`src/smoke_main.c` is a standalone allocator check (`make runtime-smoke`). It is not linked into a Menard program, because that program already defines `main`.

## Toolchain

The Makefile pins `CC` to `clang`, resolved on `PATH`. Override with `make CC=...`.

## Fixtures

`fixtures/ret0.c` is `int main(void) { return 0; }`. `fixtures/ret0.ll` is textual IR for reading. `fixtures/ret0.bc` is a small bitcode sample. Neither is an input to the build. Regenerating them embeds the local clang version, so the bytes differ across machines.

```bash
clang -S -emit-llvm -o runtime/fixtures/ret0.ll runtime/fixtures/ret0.c
clang -c -emit-llvm -o runtime/fixtures/ret0.bc runtime/fixtures/ret0.c
```
