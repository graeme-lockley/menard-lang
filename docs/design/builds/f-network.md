# Build F — Network, cleanup, supervision

**Status:** implemented (native networking; interpreter unbound for net/TLS).  
**Architecture:** [design-libraries-concurrency.md](../libraries-concurrency.md) §3.4 / §3.10.1a / §3.10.2 / phases 8–9.  
**Prior:** [build-e-actors.md](e-actors.md).

## Decisions

| # | Decision |
|---|---|
| 1 | HTTPS via **`mn_*` → OpenSSL** (one backend everywhere). |
| 2 | HTTP in **`std/http`** (Menard). |
| 3 | Sockets module: **`std/net`** with TCP + UDP. |
| 4 | **Native-only** networking/TLS; interpreter hard unbound. |
| 5 | Language **`defer`** special form; LIFO; runs on block exit and task cancel. |
| 6 | Bounded mailboxes: **block-on-full**; default capacity **1024**. |
| 7 | **`std/supervisor`**: OTP-lite one-for-one; `start-children` / `stop-children` + scaffolding `supervise`. |
| 8 | Small **`std/rest`** helpers. |
| 9 | HTTP/1.1: request line + headers + Content-Length body. |
| 10 | Shutdown: accept loop under **`Task.scope`**; `defer` closes listener. |
| 11 | Load smoke: in-repo native net/HTTP tests. |

## Layering

| Layer | Role |
|---|---|
| `defer` | Language special form + `mn_task_defer_*` |
| `stdlib/net.mnd` | TCP/UDP/TLS Platform wrappers |
| `stdlib/http.mnd` / `stdlib/rest.mnd` | Menard HTTP + REST helpers |
| `stdlib/actor.mnd` | Bounded mailboxes |
| `stdlib/supervisor.mnd` | One-for-one helpers |
| `runtime/src/net.c` / `tls.c` | Parkable sockets + OpenSSL |

## Cancel + defer matrix

| Situation | Behaviour |
|---|---|
| Block exit with `defer` | LIFO cleanups for that `do` scope |
| Soft cancel (wait cell) | Cont continues; scope `leave` runs defers |
| Hard cancel (finish) | Runtime runs all remaining defer closures before joiners wake |
| Cancel before thunk starts | No defers registered yet |

## Suspend catalogue (additions)

May suspend: `Net.accept` / `connect` / `read` / `write` / `udp-*`, TLS read/write, bounded `Mailbox.send` (full), `Http.read-request` / `serve` accept loop, `Actor.call` (unchanged).

## OpenSSL link

| Path | How |
|---|---|
| Makefile | `pkg-config openssl`, else Homebrew `openssl@3`, else `-lssl -lcrypto` |
| `mn build` / `sep.mnd` | Same Homebrew discovery; override with `MENARD_OPENSSL_CFLAGS` / `MENARD_OPENSSL_LIBS` |
| Tests | `tests/helpers/runtime-link.ts` |

Install on macOS: `brew install openssl@3`. On Linux: distro `libssl-dev` / `openssl-devel`.

## Known limitations

- Interpreter: all `mn_tcp_*` / `mn_udp_*` / `mn_tls_*` unbound.
- TLS handshake uses cooperative `poll` on the mutator (not wait-cell registered).
- `Supervisor.supervise` restart loop is scaffolding; prefer `start-children` / `stop-children` until termination probes are richer.
- HTTP: no chunked encoding; no HTTP/2.
- Load smoke: TCP echo + HTTP round-trip + bounded mailbox + supervisor start/stop in-repo; full UserManager-under-HTTP load is the `examples/http-user-manager.mnd` manual path.
