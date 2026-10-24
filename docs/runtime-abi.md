# Runtime ABI (`mn_*`)

**Status:** informal inventory for Build A — enrich as the seam grows.  
**Contracts:** Runtime ABI ≠ Platform API; Runtime ABI ≠ foreign C FFI ABI.
See [design-libraries-concurrency.md](design-libraries-concurrency.md) §2.2 and
[decisions.md](decisions.md) (purpose + library philosophy; Build B FFI).

Apps and ordinary `stdlib/` modules never call `mn_*` directly. Seam modules
declare private `extern mn_*` and publish `pub let` wrappers. `extern` is never
`pub`.

**Foreign FFI** (Build B) uses a separate conversion layer: modules under a
`/ffi/` path may declare non-`mn_*` `extern` symbols; those must not be added
to this catalogue. Example: [examples/ffi/sqlite/](../examples/ffi/sqlite/)
(`sql_*` → libsqlite3). Conversions touch tagged words only in the bridge
(e.g. `sql_ffi.c`), not in Menard source.

## Seam modules (may declare `extern`)

| Module | Role |
|---|---|
| `stdlib/sys.mnd` | Process argv, env, exit |
| `stdlib/io.mnd` | Std streams constants; read/write files and fds |
| `stdlib/fs.mnd` | Filesystem predicates and path OS ops |
| `stdlib/proc.mnd` | Argv-vector spawn |
| `stdlib/time.mnd` | Wall clock only (`mn_now_ms`) |
| `stdlib/sched.mnd` | **Internal** task runtime (Build D) — not Platform API; prefer `std/task` |
| `stdlib/net.mnd` | Parkable TCP/UDP + OpenSSL TLS (Build F); interpreter unbound |

Confinement is enforced by the host module loader (`E_EXTERN_SEAM`) and by lint
tests. Compiler/runtime-internal symbols (strings, maps, GC, apply, floats, …)
live in [`runtime/include/menard.h`](../runtime/include/menard.h) and are linked
from [`src/emit/bc-writer.mnd`](../src/emit/bc-writer.mnd); they are not this
Platform seam catalogue.

### Internal task runtime (Build D — not Platform API)

See [build-d-tasks.md](build-d-tasks.md) and [build-c-suspension.md](build-c-suspension.md).
Public façade: `stdlib/task.mnd` (no `extern`; wraps `std/sched`).

| Symbol | Seam wrapper (`std/sched`) | Notes |
|---|---|---|
| `mn_task_spawn` | `Sched.spawn` | Thunk closure; returns task id |
| `mn_task_self` | `Sched.self` | Current task id |
| `mn_task_suspend_for_test` | `Sched.suspend-for-test` | Synthetic park (harness) |
| `mn_task_resume` | `Sched.resume` | Internal enqueue — not public wake |
| `mn_task_join` | `Sched.join` | → `Result a Unit` (`Err` = cancelled) |
| `mn_task_cancel` | `Sched.cancel` | Cooperative cancel |
| `mn_task_yield` | `Sched.yield` | Cooperative yield |
| `mn_task_wait_new` | `Sched.wait-new` | Wait-cell id |
| `mn_task_wait` | `Sched.wait` | → `Result Unit Unit` (`Err` = cancelled soft-resume); multi-waiter FIFO |
| `mn_task_notify` | `Sched.notify` | Wake ≤1 waiter; sticky if none |
| `mn_task_dict_set` | `Sched.dict-set` | Type-erased process dict (Build E registry) |
| `mn_task_dict_get` | `Sched.dict-get` | → `Maybe a` (honor-system typing) |
| `mn_task_defer_enter` | `Sched.defer-enter` | Defer scope enter (Build F) |
| `mn_task_defer_push` | `Sched.defer-push` | Push zero-arg cleanup closure |
| `mn_task_defer_leave` | `Sched.defer-leave` | Run LIFO cleanups for current depth |

### Network + TLS (Build F)

See [build-f-network.md](build-f-network.md). Platform façade: `stdlib/net.mnd`.
Native only — interpreter stubs throw unbound.

| Symbol | Notes |
|---|---|
| `mn_tcp_listen` / `accept` / `connect` / `read` / `write` / `close` | Non-blocking; park via wait cells + `mn_net_poll` |
| `mn_udp_bind` / `send` / `recv` / `close` | Same parking model |
| `mn_tls_client` / `server` / `read` / `write` / `close` | OpenSSL over an existing TCP fd |

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
