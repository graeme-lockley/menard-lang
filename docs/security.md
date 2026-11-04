# Menard — Security notes

Phase 0 trust edges for network and FFI. OTH-05 expands this into a full policy
(disclosure, FFI). This page covers the HTTP DoS model (CONC-04) and TLS
verification policy (CONC-03).

## HTTP DoS model (`std/http`)

Menard HTTP/1.1 is a **one-shot** Content-Length server/client: no keep-alive,
no pipelining, no chunked transfer. That removes request-smuggling via leftover
bytes on a reused connection — extra body bytes are discarded when the fd closes.

Default caps (overridable via `Http.Limits`):

| Cap | Default | On exceed |
| --- | ---: | --- |
| Request line | 8 KiB | 431, connection closed |
| Header block | 64 KiB | 431, connection closed |
| Header count | 100 | 431, connection closed |
| Body (`Content-Length`) | 8 MiB | 413 before body allocation |

`Content-Length` is parsed with `Int.from-str` and checked against `max-body`
**before** the body is read. Conflicting duplicate `Content-Length` values and a
missing `Host` on HTTP/1.1 are **400**. Header names are matched case-insensitively
(lowercased on parse). Duplicate header names are **last-wins** (including
`Set-Cookie`).

Every public serve/request/read path takes a **relative millisecond deadline**
(CONC-02). A stalled peer cannot hold a connection forever; timed-out I/O
surfaces as `NetErr(Timeout)` (or the connection is dropped on the server).

## TLS policy (`std/net`)

TLS is **native-only** (interpreter → `Err(Unsupported)`). OpenSSL backs the seam.

**Default client** (`Net.tls-client(fd, host)` / `tls-client-timeout`):

- Peer certificate required (`SSL_VERIFY_PEER`)
- Chain verified against the **system trust store** (`SSL_CTX_set_default_verify_paths`)
- Hostname checked (`SSL_set1_host`) for `host`
- **SNI** sent (`SSL_set_tlsext_host_name`) for `host`
- Failures map to typed `IoError`: `TlsVerifyFailed` (chain/hostname),
  `TlsHandshakeFailed` (other handshake), `Timeout`, or `Other` — OpenSSL
  error text is never printed to the program’s stdout/stderr

**Insecure opt-out** (`Net.tls-client-insecure` / `tls-client-insecure-timeout`):
skips peer verification and hostname checking. **Development only** — never the
default. SNI is still sent so local SNI-aware servers work.

**Ops / test hooks** (env, not public Menard API):

| Env | Effect |
| --- | --- |
| `MENARD_TLS_CA_FILE` | Extra PEM trust roots loaded in addition to the system store |
| `MENARD_TLS_SNI_NAME` / `MENARD_TLS_SNI_CERT` / `MENARD_TLS_SNI_KEY` | Server SNI callback selects an alternate cert for the named host |

`tls-server` loads cert/key from paths; a missing path is `NotFound`. Handshakes
park via `mn_park_fd` (CONC-02) and do not block the mutator.
