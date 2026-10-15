# `-O3` and link-time optimization

Measured on 14 October 2026. The production link stays `-O2`. Neither `-O3` nor `-flto` made the native compiler enough faster to pay for itself.

## Result

The workload is the native compiler emitting `src/mn.mnd`, the same compile stage1 does in `make check-fixed-point`. Today's `-O2` compiler does that in **3.46 s** (median of five runs). The best of the four configurations, `-O3 -flto`, does it in **3.28 s**. That is a 5.1% improvement, 0.18 s. The keep rule required 10%, and it required the extra clang time to be smaller than the time one self-compile saves. Linking that compiler costs **0.71 s** more than the five-run `-O2` link.

`-O3` alone made the self-compile slower (3.93 s).

| Configuration | Self-compile median | Versus unmodified `-O2` | Clang time to link `mn` | Extra clang time | Kept |
|---|---:|---:|---:|---:|---|
| `-O2`, no clobber | 3.460 s | — | 3.10 s (one run) | — | yes, this is the tree |
| `-O2` | 3.485 s | +0.7% | 2.932 s | — | no |
| `-O3` | 3.927 s | +13.5% | 3.050 s | +0.12 s | no |
| `-O2 -flto` | 3.327 s | −3.8% | 3.622 s | +0.69 s | no |
| `-O3 -flto` | 3.282 s | −5.1% | 3.638 s | +0.71 s | no |

The four rows under the first were linked with a memory clobber in `mn_alloc` and `mn_gc_collect`, so that `-flto` could not keep a GC root in a register. That clobber was removed after the run. The clang column is the median of five single invocations of the same shape as `make mn`: one `clang` process compiles the runtime and links it with the bitcode. "Extra" is against the five-run `-O2` row (2.932 s), which is the fair comparison across the clobber builds.

A configuration had to pass all three tests:

1. Median self-compile at least 10% below the unmodified `-O2` compiler (3.46 s, so at most 3.11 s).
2. Extra clang time to link `mn` smaller than the time that one self-compile saves.
3. The compiler still emits byte-identical bitcode, and `examples/heap-churn.mnd` still passes under `MENARD_GC_STRESS=1` and `MENARD_HEAP_VERIFY=1`.

Every configuration passed test 3. None passed test 1. The two LTO builds also fail test 2. Against the unmodified compiler, `-O2 -flto` saves 0.13 s per self-compile and `-O3 -flto` saves 0.18 s; linking the compiler costs 0.69 s and 0.71 s more. `make check-fixed-point` was not re-run. The link flags in the tree did not change, so the existing stage1/stage2 comparison still describes the toolchain.

## Machine

Apple M4, 10 cores, 24 GiB. macOS 27.0.1 (build 26A434).

```
Homebrew clang version 23.1.2
Target: arm64-apple-darwin27.0.0
Thread model: posix
InstalledDir: /opt/homebrew/Cellar/llvm/23.1.2/bin
```

Runs were serial, in one terminal, with no other build in progress. Each timed command had one warmup, then five measured runs. The reported spread is the minimum and maximum of those five. Timing is `time.perf_counter` around the child process, so it includes process startup and excludes the harness.

## What was linked

One bitcode file of `src/mn.mnd` (3,148,772 bytes), emitted by the installed `./mn` before any runtime edit. The same file was the input for every link, and the reference for the "emit matches" check. `hello.mnd` (6,636 bytes) and `examples/heap-churn.mnd` (52,192 bytes) were emitted the same way.

The runtime sources on the link line are the `RUNTIME_LIB_SRCS` list in the Makefile: `alloc.c`, `gc.c`, `panic.c`, `print.c`, `shadow.c`, `variants.c`, `str.c`, `map.c`, `closure.c`, `io.c`, `equal.c`.

The combined command, which is what `make mn` waits for:

```
clang -std=c11 -Wall -Wextra -D_DEFAULT_SOURCE -Iruntime/include \
  <opt> mn.bc <runtime sources> -lm -o mn
```

`<opt>` was `-O2`, `-O3`, `-O2 -flto`, or `-O3 -flto`.

The split, reported so compile time and link time are separate, was `clang -c <opt>` of those C files, then a second `clang <opt>` of the resulting objects plus the bitcode. With `-flto`, the `.c` compile emits bitcode objects and the link runs the optimizer. The keep rule uses the combined command, not the sum of the split, because that is the invocation `make` and `./mn build` use. The two are within a few tens of milliseconds of each other.

`-flto` accepted the current bitcode. The module records a target triple and no data layout. Clang did not reject the link, the resulting binary ran, and its emit matched the reference, so no `MODULE_CODE_DATALAYOUT` record was added.

## Correctness

Each of the four clobber-built compilers emitted `src/mn.mnd` to a bitcode file identical to the reference, including the file written on the last measured run.

`heap-churn` was linked with the same flags and run once with both stress and heap-verify set. All four exited 0 and printed `list 528 map 62 sb 40 clo 16`. Stderr was empty. These are single runs, not the five-run medians:

| Configuration | `heap-churn` under stress |
|---|---:|
| `-O2` | 0.304 s |
| `-O3` | 0.856 s |
| `-O2 -flto` | 0.294 s |
| `-O3 -flto` | 0.292 s |

`-O3` is correct and substantially slower on this allocating program. That number is not part of the keep rule. It is the same direction as the self-compile result: raising the optimization level without LTO did not help.

## Compiler runtime

`mn emit src/mn.mnd out.bc`. Seconds.

| Configuration | Min | Median | Max |
|---|---:|---:|---:|
| `-O2`, no clobber | 3.430 | 3.460 | 3.470 |
| `-O2` | 3.479 | 3.485 | 3.522 |
| `-O3` | 3.901 | 3.927 | 3.981 |
| `-O2 -flto` | 3.324 | 3.327 | 3.358 |
| `-O3 -flto` | 3.273 | 3.282 | 3.292 |

The no-clobber samples were 3.43, 3.45, 3.47, 3.46, 3.46. The clobber `-O2` range starts at 3.479, just above the no-clobber maximum, so the barrier is a small systematic cost of about 25 ms (0.7%), not a fluke inside one run. It is far below the 10% bar. The decision uses the no-clobber median as the `-O2` baseline, which is what the plan specifies when the barrier moves the time.

Against the clobber `-O2` row, which holds the runtime constant, `-O2 -flto` is 4.5% faster and `-O3 -flto` is 5.8% faster. Still short of 10%.

## Clang time

### Combined invocation

This is one process. It is the cost of producing the compiler, and the cost of linking `hello.mnd`. Seconds, five runs.

| Configuration | Link `mn` min | Median | Max | Link `hello` min | Median | Max |
|---|---:|---:|---:|---:|---:|---:|
| `-O2` | 2.908 | 2.932 | 2.964 | 0.676 | 0.678 | 0.714 |
| `-O3` | 3.036 | 3.050 | 3.072 | 0.692 | 0.695 | 0.699 |
| `-O2 -flto` | 3.615 | 3.622 | 3.653 | 0.630 | 0.631 | 0.638 |
| `-O3 -flto` | 3.625 | 3.638 | 3.672 | 0.630 | 0.633 | 0.636 |

Linking the compiler with LTO costs about 0.7 s more than `-O2`. Linking `hello.mnd` with LTO is about 45 ms faster, because the C files are emitted as bitcode instead of being fully code-generated in that process, and the program is small. The hello number does not veto a configuration. It does show that `-flto` on the driver link line is not a multi-second tax on a small program, on this machine, with this runtime.

The no-clobber `-O2` link of `mn` was timed once, at 3.10 s (`/usr/bin/time -p`), before the five-run series. It is not a median. The five-run `-O2` row above is the one used as the clang baseline.

### Compile and link split

`clang -c` of the eleven runtime files, then a link of those objects with the bitcode. Seconds, medians. Minimum and maximum stayed inside a few tens of milliseconds of the median; the widest link-of-`mn` range is `-O3`, 2.448 s to 2.509 s.

| Configuration | `clang -c` runtime | Link `mn` | Sum | Link `hello` |
|---|---:|---:|---:|---:|
| `-O2` | 0.584 | 2.345 | 2.928 | 0.108 |
| `-O3` | 0.614 | 2.465 | 3.079 | 0.109 |
| `-O2 -flto` | 0.539 | 3.132 | 3.671 | 0.121 |
| `-O3 -flto` | 0.547 | 3.135 | 3.681 | 0.121 |

LTO moves time into the link, as expected. The compile step gets slightly cheaper. The hello link, once the runtime objects already exist, grows by about 13 ms.

## Binary size

| Configuration | `mn` | `hello` |
|---|---:|---:|
| `-O2` | 2,204,520 | 96,512 |
| `-O3` | 2,219,608 | 95,072 |
| `-O2 -flto` | 1,973,560 | 51,936 |
| `-O3 -flto` | 1,973,544 | 51,936 |

LTO shrinks the compiler by about 231 KB and cuts the hello binary almost in half. Size was recorded and was not part of the keep rule.

## What is in the tree

The Makefile, `clang-argv` in `src/mn.mnd`, and `link-argv` in `src/cache/sep.mnd` are still `-O2` with no `-flto`. The memory clobber was not left in `runtime/src/alloc.c` or `runtime/src/gc.c`. The bitcode writer was not changed. Corpus tests that invoke clang themselves are still at clang's default, `-O0`; they were not the production link under test.

This note is the artifact that remains.
