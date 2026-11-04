# Security policy

Vulnerability disclosure and the standing threat model for Menard. Runtime
unsafe-boundary detail (TLS, HTTP, FFI lifetimes) lives in
[docs/security.md](docs/security.md).

## Supported versions

Until a tagged release (OTH-09), only the tip of `main` is supported. Pre-release
and unreleased trees receive fixes on a best-effort basis; there is no
back-port promise for older commits.

## Reporting a vulnerability

Please use **GitHub private vulnerability reporting** on this repository (Security
→ Report a vulnerability). Do not open a public issue for an unfixed security
defect. Include a short description, impact, and steps or a minimal program that
shows the problem when you can share one safely.

We will acknowledge the report, assess it against the threat model below, and
coordinate a fix and disclosure when one is warranted.

## Threat model

**In scope — Menard memory safety.** Inside the language and the GC runtime,
Menard programs do not have null, raw pointer arithmetic, or unchecked buffer
writes. The dual-host seam (`mn_*`) is the ambient OS boundary; ordinary
Menard code stays on the typed, GC-managed heap.

**Trusted C/FFI and OpenSSL.** Code that crosses into C is trusted:

- The C runtime that implements `mn_*`.
- OpenSSL, which backs TLS on the native net seam.
- Foreign libraries reached through `/ffi/` bridges (for example libsqlite3).

Menard's GC does not make those C libraries memory-safe. A bug in OpenSSL, in a
bridge, or in a foreign library is outside Menard's memory-safety claim; see
[docs/security.md](docs/security.md) and [docs/design/ffi.md](docs/design/ffi.md).

**Dependency integrity (policy).** Dependencies are **checksummed**, and there is
**no network at compile** time by default (offline compile). That policy is
**enforced by OTH-04** (`deps.mnd`, checksums, `--offline`). Until OTH-04 lands,
today's `github:` **cache-miss fetch** (curl/tar into `~/.menard/deps`) is an
**acknowledged gap**: a compile can still pull unverified source over the
network when the cache is cold.

## Out of scope

- Bugs that require trusting a compromised C/FFI library, OpenSSL, or the host
  OS as correct.
- Denial-of-service that exhausts deliberately configured HTTP/TLS limits after
  those limits are applied (see [docs/security.md](docs/security.md)); raising
  caps is an operator choice.
- Social engineering, physical access, or malicious Menard source the operator
  chose to run with full ambient rights (`std/fs`, `std/proc`, `std/net`).
- Supply-chain gaps owned by OTH-04 until that item closes (checksum / offline
  enforcement).
- Setting up GitHub Security Advisories product configuration beyond this
  disclosure process.
