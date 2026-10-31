# Menard — Security notes

Phase 0 trust edges for network and FFI. OTH-05 expands this into a full policy
(TLS verification, disclosure, FFI). This page starts with the HTTP DoS model
required by CONC-04.

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

Every public serve/request path takes a **relative millisecond deadline**
(CONC-02). A stalled peer cannot hold a connection forever; timed-out I/O
surfaces as `NetErr(Timeout)` (or the connection is dropped on the server).

TLS peer verification, SNI, and OpenSSL hardening are CONC-03 / OTH-05 — not
covered here yet.
