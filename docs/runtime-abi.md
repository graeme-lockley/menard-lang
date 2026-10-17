# Runtime ABI (`mn_*`)

**Status:** informal inventory for Build A — enrich as the seam grows.  
**Contracts:** Runtime ABI ≠ Platform API; Runtime ABI ≠ foreign C FFI ABI.
See [design-libraries-concurrency.md](design-libraries-concurrency.md) §2.2 and
[decisions.md](decisions.md) (purpose + library philosophy ratification).

Apps and ordinary `stdlib/` modules never call `mn_*` directly. Seam modules
declare private `extern mn_*` and publish `pub let` wrappers. `extern` is never
`pub`.

## Seam modules (may declare `extern`)

| Module | Role |
|---|---|
| `stdlib/sys.mnd` | Process argv, env, exit |
| `stdlib/io.mnd` | Std streams constants; read/write files and fds |
| `stdlib/fs.mnd` | Filesystem predicates and path OS ops |
| `stdlib/proc.mnd` | Argv-vector spawn |
| `stdlib/time.mnd` | Wall clock only (`mn_now_ms`) |

Confinement is enforced by the host module loader (`E_EXTERN_SEAM`) and by lint
tests. Compiler/runtime-internal symbols (strings, maps, GC, apply, floats, …)
live in [`runtime/include/menard.h`](../runtime/include/menard.h) and are linked
from [`src/emit/bc-writer.mnd`](../src/emit/bc-writer.mnd); they are not this
Platform seam catalogue.

## App-facing seam symbols

### `std/sys`

| Symbol | Platform wrapper | Notes |
|---|---|---|
| `mn_exit` | `Sys.exit` | Exit code truncated to 8 bits by the runtime |
| `mn_arg_count` | `Sys.arg-count` | After `mn_init`; no program name |
| `mn_arg` | `Sys.arg` | Panics if out of range |
| `mn_getenv` | `Sys.getenv` | `Maybe Str` |

### `std/io`

| Symbol | Platform wrapper | Notes |
|---|---|---|
| `mn_write` | `Io.write` | `Result Unit IoError` |
| `mn_read_file` | `Io.read-file` | `Result Str IoError` |
| `mn_write_file` | `Io.write-file` | `Result Unit IoError` |

`IoError`: `NotFound`, `Permission`, `Exists`, `IsADirectory`, `NotADirectory`,
`InvalidPath`, `TooLarge`, `Other(Int)`.

### `std/fs`

| Symbol | Platform wrapper | Notes |
|---|---|---|
| `mn_exists` | `Fs.exists` | |
| `mn_rename` | `Fs.rename` | `Result Unit IoError` |
| `mn_isatty` | `Fs.isatty` | |
| `mn_mtime` | `Fs.mtime` | Epoch ms, or `0` if missing |
| `mn_cwd` | `Fs.cwd` | |
| `mn_ensure_dir` | `Fs.ensure-dir` | `mkdir -p` |
| `mn_list_dir` | `Fs.list-dir` | Newline-separated names |
| `mn_realpath` | `Fs.realpath` | Empty string on failure |
| `mn_remove` | `Fs.remove` | |
| `mn_is_dir` | `Fs.is-dir` | |

Wall clock is **not** on `Fs`; see `std/time`.

### `std/time`

| Symbol | Platform wrapper | Notes |
|---|---|---|
| `mn_now_ms` | `Time.now-ms` | `CLOCK_REALTIME` epoch milliseconds |

Durations, civil time, offsets, and formatting are pure Menard in `std/time`.

### `std/proc`

| Symbol | Platform wrapper | Notes |
|---|---|---|
| `mn_spawn` | `Proc.spawn` | `Result SpawnStatus SpawnError` |
| `mn_spawn_capture` | `Proc.spawn-capture` | `Result SpawnOutput SpawnError` |

`SpawnStatus`: `Exited(Int)`, `Signalled(Int)`.  
`SpawnError`: `NotFound`, `NotExecutable`, `Permission`, `InvalidArgument`,
`TooManyArguments`, `Unsupported`.

## Dual host

Every seam symbol is implemented in the C runtime and in the TypeScript
interpreter host. Observable behaviour must agree; internals need not.

## Growing the ABI

1. Prefer a Menard Platform API in `stdlib/` when the capability is expressible
   without the OS.
2. Add `mn_*` only for OS contact (or irreducible runtime representation with a
   named hot client — placement rule / ADR 28).
3. Declare `extern` only in a seam module; wrap with `pub let`; document here;
   add `@test` on the wrapper (corpus only when pinning dual-host seam
   behaviour).
