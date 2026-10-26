# Menard backlog

**Source of truth for status.** The specification and acceptance criteria are the [Build F review](reviews/2026-10-24-build-f.md); this file is the live work queue. GitHub issues are the public work items and discussion, linked by the same ID. The review is deliberately not the tracker: do not tick its checkboxes.

- **First item:** [LANG-01](reviews/2026-10-24-build-f.md#lang-01) — the native `show` fix first (the canonical-text half is blocked by LANG-07/02/10).
- **Phase 0 epic:** [#30](https://github.com/graeme-lockley/menard-lang/issues/30) — the 18 Phase 0 items as a checklist.
- **Opened:** the 18 Phase 0 issues were opened on 2026-10-24, all in the `v0.6 — Truth and trust` milestone.
- **Phase 0** is the current focus. Everything else is `todo` until its phase opens.
- **Statuses:** `todo` (not scheduled), `ready` (can start; see *Blocked by* for slices that must wait), `in-progress`, `blocked` (no useful slice can start), `review` (PR open), `done`, `wontfix`.
- **Definition of done:** every acceptance criterion in the linked review item is satisfied, `make test` and `make check-fixed-point` are green, the named docs are updated, and this row is `done` in the same PR that closes the issue.
- **Update rule:** a PR that closes an item updates its row here and uses `Closes #<issue>`; `make backlog-check` verifies that every review ID has exactly one row.
- **Next up:** `make next` prints the items whose every blocker is `done` — safe to start — plus what is in progress and one blocker away. `make next ARGS=--all` ignores the phase gate; the cycles it reports are missing from `make backlog-check`.

## Summary

| Phase | Theme | Items | Ready | In progress | Done |
| --- | --- | ---: | ---: | ---: | ---: |
| 0 | Truth, trust and the unsafe edges | 18 | 13 | 1 | 4 |
| 1 | Daily loop and language decisions | 18 | 0 | 0 | 0 |
| 2 | Standard library | 12 | 0 | 0 | 0 |
| 3 | Operational concurrency | 8 | 0 | 0 | 0 |
| 4 | Project and ecosystem | 17 | 0 | 0 | 0 |
| 5 | Later | 9 | 0 | 0 | 0 |
| **Total** | | **82** | **13** | **1** | **4** |

Priority mix: P0 = 24, P1 = 34, P2 = 19, P3 = 5.

## Work items

Rows are ordered by phase, then priority, then area, then ID.

| ID | Title | Area | Priority | Phase | Status | Blocked by | Issue | PR |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| [LANG-01](reviews/2026-10-24-build-f.md#lang-01) | `show` must be human-readable and correct for every showable type | Language | P0 | 0 | in-progress | LANG-07, LANG-02, LANG-10 (text half) | [#12](https://github.com/graeme-lockley/menard-lang/issues/12) | [#32](https://github.com/graeme-lockley/menard-lang/pull/32) |
| [LANG-02](reviews/2026-10-24-build-f.md#lang-02) | Canonical `Float` text: shortest round-trip, implemented in C first | Language | P0 | 0 | done | — | [#13](https://github.com/graeme-lockley/menard-lang/issues/13) | — |
| [LANG-03](reviews/2026-10-24-build-f.md#lang-03) | Make `Float` orderable with one consistent total order | Language | P0 | 0 | ready | LANG-02, LIB-01 | [#14](https://github.com/graeme-lockley/menard-lang/issues/14) | — |
| [LANG-04](reviews/2026-10-24-build-f.md#lang-04) | The host typer still crashes on a qualified-import constructor, and still duplicates some diagnostics | Language | P0 | 0 | done | — | [#15](https://github.com/graeme-lockley/menard-lang/issues/15) | [#38](https://github.com/graeme-lockley/menard-lang/pull/38) |
| [LIB-06](reviews/2026-10-24-build-f.md#lib-06) | `Map` keys beyond `Int`/`Str` are silently wrong natively | Libraries | P0 | 0 | ready | LANG-03 (Float keys) | [#17](https://github.com/graeme-lockley/menard-lang/issues/17) | — |
| [CONC-01](reviews/2026-10-24-build-f.md#conc-01) | `Mailbox.close` must wake every waiter, including blocked senders | Concurrency | P0 | 0 | done | — | [#18](https://github.com/graeme-lockley/menard-lang/issues/18) | — |
| [CONC-02](reviews/2026-10-24-build-f.md#conc-02) | Deadlines for every blocking operation | Concurrency | P0 | 0 | ready | CONC-01 | [#19](https://github.com/graeme-lockley/menard-lang/issues/19) | — |
| [CONC-03](reviews/2026-10-24-build-f.md#conc-03) | TLS must verify the peer, send SNI, and not block the mutator | Concurrency | P0 | 0 | ready | CONC-02, CONC-10 | [#20](https://github.com/graeme-lockley/menard-lang/issues/20) | — |
| [CONC-04](reviews/2026-10-24-build-f.md#conc-04) | HTTP limits, header correctness, and connection hygiene | Concurrency | P0 | 0 | ready | CONC-02 | [#21](https://github.com/graeme-lockley/menard-lang/issues/21) | — |
| [CONC-05](reviews/2026-10-24-build-f.md#conc-05) | An actor's death must not hang its callers | Concurrency | P0 | 0 | ready | CONC-01, CONC-02 | [#22](https://github.com/graeme-lockley/menard-lang/issues/22) | — |
| [DOC-01](reviews/2026-10-24-build-f.md#doc-01) | Truth pass on the guide, with executable snippets | Documentation | P0 | 0 | ready | LANG-01, LANG-03, LANG-06, LANG-07, LANG-15, LIB-08, CONC-10 | [#28](https://github.com/graeme-lockley/menard-lang/issues/28) | — |
| [DOC-02](reviews/2026-10-24-build-f.md#doc-02) | Specification conformance, the new language decisions, and honest sizing | Documentation | P0 | 0 | ready | LANG-01, LANG-02, LANG-03, LANG-06, LANG-07, LANG-11, LANG-15, CONC-01, CONC-03, CONC-04, CONC-10, DOC-01 | [#29](https://github.com/graeme-lockley/menard-lang/issues/29) | — |
| [OTH-01](reviews/2026-10-24-build-f.md#oth-01) | Add an MIT licence | Other | P0 | 0 | done | — | [#24](https://github.com/graeme-lockley/menard-lang/issues/24) | [#34](https://github.com/graeme-lockley/menard-lang/pull/34) |
| [OTH-02](reviews/2026-10-24-build-f.md#oth-02) | Harden CI, add OpenSSL and macOS, and run the new checks | Other | P0 | 0 | ready | TOOL-01, TOOL-03, TOOL-05, CONC-03, CONC-04, CONC-10, OTH-03 | [#25](https://github.com/graeme-lockley/menard-lang/issues/25) | — |
| [OTH-03](reviews/2026-10-24-build-f.md#oth-03) | Build the regression corpus the P0 bugs prove is missing | Other | P0 | 0 | ready | LANG-01, LANG-02, LANG-03, LANG-04, LANG-06, LANG-07, LANG-15, CONC-01, CONC-03, CONC-04, CONC-06, LIB-06 | [#26](https://github.com/graeme-lockley/menard-lang/issues/26) | — |
| [LANG-09](reviews/2026-10-24-build-f.md#lang-09) | Operator-spacing diagnostics, and a real `help:` line | Language | P1 | 0 | ready | TOOL-03, DOC-05 | [#16](https://github.com/graeme-lockley/menard-lang/issues/16) | — |
| [CONC-10](reviews/2026-10-24-build-f.md#conc-10) | Interpreter stubs for net/TLS, and a defined oracle boundary | Concurrency | P1 | 0 | ready | CONC-03, CONC-04 | [#23](https://github.com/graeme-lockley/menard-lang/issues/23) | — |
| [OTH-05](reviews/2026-10-24-build-f.md#oth-05) | Security policy: TLS verification, HTTP limits, FFI and disclosure | Other | P1 | 0 | ready | CONC-03, CONC-04, CONC-10 | [#27](https://github.com/graeme-lockley/menard-lang/issues/27) | — |
| [TOOL-01](reviews/2026-10-24-build-f.md#tool-01) | `mn fmt` and `mn fmt --check` | Tooling | P0 | 1 | todo | LANG-09, LANG-14 | — | — |
| [TOOL-02](reviews/2026-10-24-build-f.md#tool-02) | `--version`, `--help`, and `--print-toolchain` | Tooling | P0 | 1 | todo | — | — | — |
| [TOOL-03](reviews/2026-10-24-build-f.md#tool-03) | Machine-readable diagnostics: `--json` and a stable schema | Tooling | P0 | 1 | todo | LANG-04 | — | — |
| [DOC-03](reviews/2026-10-24-build-f.md#doc-03) | `AGENTS.md` and a one-page reference | Documentation | P0 | 1 | todo | DOC-01 | — | — |
| [LANG-05](reviews/2026-10-24-build-f.md#lang-05) | Expected-type propagation stops at lambda bodies, so field and tuple projections need annotations | Language | P1 | 1 | todo | LANG-01 | — | — |
| [LANG-06](reviews/2026-10-24-build-f.md#lang-06) | `?` propagates; `??` supplies the default | Language | P1 | 1 | todo | LANG-12, LANG-15, OTH-10 | — | — |
| [LANG-07](reviews/2026-10-24-build-f.md#lang-07) | Nullary constructors are values; the `None()`/`Red()` call form is removed | Language | P1 | 1 | todo | LANG-01, OTH-10 | — | — |
| [LANG-08](reviews/2026-10-24-build-f.md#lang-08) | The eight-argument closure limit is enforced only by the backend | Language | P1 | 1 | todo | — | — | — |
| [LANG-10](reviews/2026-10-24-build-f.md#lang-10) | `Char` shows as a decimal number | Language | P1 | 1 | todo | — | — | — |
| [LANG-11](reviews/2026-10-24-build-f.md#lang-11) | Local functions with explicit type parameters generalize per use | Language | P1 | 1 | todo | — | — | — |
| [LANG-15](reviews/2026-10-24-build-f.md#lang-15) | Pin `defer` semantics, tests and documentation | Language | P1 | 1 | todo | LANG-12, CONC-02 | — | — |
| [LIB-08](reviews/2026-10-24-build-f.md#lib-08) | Remove `Int.parse`; `Int.from-str` is the only integer parser | Libraries | P1 | 1 | todo | LANG-06, TOOL-12 | — | — |
| [DOC-04](reviews/2026-10-24-build-f.md#doc-04) | Contributor guide and architecture map | Documentation | P1 | 1 | todo | DOC-03 | — | — |
| [DOC-05](reviews/2026-10-24-build-f.md#doc-05) | Error-code catalogue, with `help:` | Documentation | P1 | 1 | todo | LANG-04, LANG-09, TOOL-03 | — | — |
| [DOC-07](reviews/2026-10-24-build-f.md#doc-07) | README refresh for Build F | Documentation | P1 | 1 | todo | TOOL-01, TOOL-02, TOOL-05, TOOL-09, TOOL-13, OTH-01 | — | — |
| [DOC-08](reviews/2026-10-24-build-f.md#doc-08) | Decisions journal: index, status, and supersession | Documentation | P1 | 1 | todo | — | — | — |
| [OTH-08](reviews/2026-10-24-build-f.md#oth-08) | Repository hygiene | Other | P1 | 1 | todo | OTH-01 | — | — |
| [LANG-12](reviews/2026-10-24-build-f.md#lang-12) | Pin arithmetic, `return`, `defer` and loop semantics | Language | P2 | 1 | todo | LANG-06, LANG-15 | — | — |
| [LIB-01](reviews/2026-10-24-build-f.md#lib-01) | Add `std/float`, including the total-order functions | Libraries | P0 | 2 | todo | LANG-02, LANG-03 | — | — |
| [LIB-02](reviews/2026-10-24-build-f.md#lib-02) | Add `std/set` | Libraries | P0 | 2 | todo | LIB-04 | — | — |
| [LIB-03](reviews/2026-10-24-build-f.md#lib-03) | Unicode text: `String.chars`, `String.from-chars`, and `Char` code points | Libraries | P0 | 2 | todo | — | — | — |
| [LIB-04](reviews/2026-10-24-build-f.md#lib-04) | Replace insertion sort with a stable O(n log n) sort | Libraries | P0 | 2 | todo | LANG-03 | — | — |
| [LIB-05](reviews/2026-10-24-build-f.md#lib-05) | JSON: valid float encoding, error positions, and a `Result` encoder | Libraries | P0 | 2 | todo | LANG-02, LIB-01, LANG-06, LIB-08 | — | — |
| [LIB-07](reviews/2026-10-24-build-f.md#lib-07) | Bring the collection API to Elm parity where Elm is the better reference | Libraries | P1 | 2 | todo | LIB-02, LIB-03, LIB-08 | — | — |
| [LIB-09](reviews/2026-10-24-build-f.md#lib-09) | `list-dir` returns a sorted `List Str`, not an OS-ordered string | Libraries | P1 | 2 | todo | OTH-10 | — | — |
| [LIB-10](reviews/2026-10-24-build-f.md#lib-10) | Stability tiers for the whole library, including the new network modules | Libraries | P1 | 2 | todo | — | — | — |
| [TOOL-06](reviews/2026-10-24-build-f.md#tool-06) | `mn test` ergonomics, seeds, and native-only tests | Tooling | P1 | 2 | todo | LIB-13, CONC-10 | — | — |
| [DOC-06](reviews/2026-10-24-build-f.md#doc-06) | `docs/stdlib.md` completeness and accuracy, including the new modules | Documentation | P1 | 2 | todo | LIB-01, LIB-02, LIB-03, LIB-04, LIB-05, LIB-06, LIB-07, LIB-08, LIB-09, LIB-10, LIB-11, LIB-12, LIB-13, TOOL-05 | — | — |
| [LIB-13](reviews/2026-10-24-build-f.md#lib-13) | Seeded randomness and generative tests | Libraries | P2 | 2 | todo | LIB-01 | — | — |
| [LIB-14](reviews/2026-10-24-build-f.md#lib-14) | Numeric helpers: powers, conversions, and integer formatting | Libraries | P3 | 2 | todo | LIB-01 | — | — |
| [CONC-06](reviews/2026-10-24-build-f.md#conc-06) | Harden supervision so it cannot hang or spin | Concurrency | P1 | 3 | todo | CONC-02, CONC-05 | — | — |
| [CONC-07](reviews/2026-10-24-build-f.md#conc-07) | Bounded mailboxes: verify, expose, and finish the edges | Concurrency | P1 | 3 | todo | CONC-01, CONC-02 | — | — |
| [CONC-08](reviews/2026-10-24-build-f.md#conc-08) | Make the registry type-safe | Concurrency | P1 | 3 | todo | — | — | — |
| [CONC-09](reviews/2026-10-24-build-f.md#conc-09) | Remove the `spawn-in` GC rooting workaround | Concurrency | P1 | 3 | todo | — | — | — |
| [CONC-11](reviews/2026-10-24-build-f.md#conc-11) | `select`: wait on sockets, mailboxes and a deadline | Concurrency | P2 | 3 | todo | CONC-02, CONC-10 | — | — |
| [CONC-12](reviews/2026-10-24-build-f.md#conc-12) | Fairness and cancellation latency | Concurrency | P2 | 3 | todo | CONC-02 | — | — |
| [CONC-13](reviews/2026-10-24-build-f.md#conc-13) | Parallelism ADR: state the model | Concurrency | P2 | 3 | todo | — | — | — |
| [CONC-14](reviews/2026-10-24-build-f.md#conc-14) | Observability: depth, capacity, task list, trace | Concurrency | P2 | 3 | todo | CONC-07, CONC-10 | — | — |
| [TOOL-04](reviews/2026-10-24-build-f.md#tool-04) | Language server (`mn lsp`) | Tooling | P1 | 4 | todo | TOOL-01, TOOL-03 | — | — |
| [TOOL-05](reviews/2026-10-24-build-f.md#tool-05) | `mn doc`: a Menard documentation server and static site | Tooling | P1 | 4 | todo | CONC-02, CONC-04, LANG-15, TOOL-03, DOC-06 | — | — |
| [TOOL-07](reviews/2026-10-24-build-f.md#tool-07) | Editor grammar and highlighting, including `defer` and the new show forms | Tooling | P1 | 4 | todo | TOOL-04 | — | — |
| [OTH-04](reviews/2026-10-24-build-f.md#oth-04) | Dependency hygiene without a foreign format: `deps.mnd`, checksums, offline | Other | P1 | 4 | todo | TOOL-09, TOOL-10 | — | — |
| [OTH-06](reviews/2026-10-24-build-f.md#oth-06) | Performance credibility | Other | P1 | 4 | todo | TOOL-11, LIB-04 | — | — |
| [OTH-07](reviews/2026-10-24-build-f.md#oth-07) | Portability and toolchain discovery, including OpenSSL | Other | P1 | 4 | todo | OTH-02, LANG-03, TOOL-02 | — | — |
| [OTH-09](reviews/2026-10-24-build-f.md#oth-09) | Release engineering and versioning | Other | P1 | 4 | todo | OTH-01, TOOL-02, OTH-02 | — | — |
| [OTH-10](reviews/2026-10-24-build-f.md#oth-10) | Compatibility, editions, and deprecation policy | Other | P1 | 4 | todo | TOOL-09, TOOL-12, DOC-05 | — | — |
| [OTH-13](reviews/2026-10-24-build-f.md#oth-13) | Re-review of Build F: OpenSSL, TLS policy, and the FFI boundary | Other | P1 | 4 | todo | CONC-03, CONC-04, CONC-10, OTH-02, OTH-05, OTH-07 | — | — |
| [TOOL-08](reviews/2026-10-24-build-f.md#tool-08) | Debuggable native panics and a trace mode | Tooling | P2 | 4 | todo | CONC-14 | — | — |
| [TOOL-09](reviews/2026-10-24-build-f.md#tool-09) | Projects are Menard source: `project.mnd`, `mn new`, and `deps.mnd` | Tooling | P2 | 4 | todo | TOOL-02, TOOL-10, OTH-04 | — | — |
| [TOOL-10](reviews/2026-10-24-build-f.md#tool-10) | Dependency management: `deps.mnd`, checksums, offline, vendor | Tooling | P2 | 4 | todo | TOOL-09 | — | — |
| [TOOL-11](reviews/2026-10-24-build-f.md#tool-11) | A benchmark harness with published numbers | Tooling | P2 | 4 | todo | LIB-04, TOOL-02 | — | — |
| [TOOL-12](reviews/2026-10-24-build-f.md#tool-12) | `mn fix` codemods for the mechanical migrations | Tooling | P2 | 4 | todo | LANG-01, LANG-06, LANG-07, LIB-05, LIB-08, LIB-09, TOOL-01 | — | — |
| [TOOL-13](reviews/2026-10-24-build-f.md#tool-13) | `mn eval` and a Menard-native REPL | Tooling | P2 | 4 | todo | LANG-06, LANG-15, TOOL-02 | — | — |
| [DOC-10](reviews/2026-10-24-build-f.md#doc-10) | A cookbook and a learning path | Documentation | P2 | 4 | todo | CONC-03, CONC-04, CONC-10 | — | — |
| [DOC-11](reviews/2026-10-24-build-f.md#doc-11) | The docs site is `mn doc --static`, not a second generator | Documentation | P3 | 4 | todo | TOOL-05, OTH-09 | — | — |
| [LANG-13](reviews/2026-10-24-build-f.md#lang-13) | Unreachable and redundant pattern arms are not diagnosed | Language | P2 | 5 | todo | LANG-05, DOC-05 | — | — |
| [LIB-11](reviews/2026-10-24-build-f.md#lib-11) | Time: calendar helpers and a clearer format/parse surface | Libraries | P2 | 5 | todo | — | — | — |
| [LIB-12](reviews/2026-10-24-build-f.md#lib-12) | Path: URL/percent helpers and edge-case tests | Libraries | P2 | 5 | todo | — | — | — |
| [DOC-09](reviews/2026-10-24-build-f.md#doc-09) | Docs lint: links, anchors, fences, and style | Documentation | P2 | 5 | todo | — | — | — |
| [OTH-11](reviews/2026-10-24-build-f.md#oth-11) | Governance and community scaffolding | Other | P2 | 5 | todo | DOC-04, OTH-09 | — | — |
| [OTH-12](reviews/2026-10-24-build-f.md#oth-12) | Runtime debugging and environment documentation | Other | P2 | 5 | todo | TOOL-08 | — | — |
| [LANG-14](reviews/2026-10-24-build-f.md#lang-14) | A one-line `match` cannot be written inside a lambda | Language | P3 | 5 | todo | TOOL-01 | — | — |
| [TOOL-14](reviews/2026-10-24-build-f.md#tool-14) | Shell completions and a man page | Tooling | P3 | 5 | todo | TOOL-02 | — | — |
| [OTH-14](reviews/2026-10-24-build-f.md#oth-14) | Playground / WASM | Other | P3 | 5 | todo | — | — | — |
