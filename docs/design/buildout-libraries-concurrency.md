# Buildout: libraries and concurrency

**Status:** planning — break the architecture into shippable builds.  
**Architecture:** [design-libraries-concurrency.md](libraries-concurrency.md)  
(Do not reopen that design here; answer open questions with plans and code.)

This document turns the design’s two initiatives and nine implementation phases
into **six builds** for planning. Builds **A–B** grow the Platform API without
concurrency. Builds **C–F** are the concurrency track; **C is a hard gate**.

```
purpose → library philosophy → concurrency model → runtime
              │                        │
         Builds A, B              Builds C → D → E → F
         (start now)              (after C succeeds)
```

---

## Recommended shape (overview)

| Build | Name | Design phases | Concurrency? |
|---|---|---|---|
| **A** | Platform foundation | 1–2 | No |
| **B** | FFI proving ground | 3 | No |
| **C** | Suspension hard gate | 4 | Gate |
| **D** | Task runtime + public `Task.`* | 5–6 | After C |
| **E** | Mailbox + Actor | 7 | After D |
| **F** | Network, cleanup, supervision | 8–9 | After E |

**Rule:** do not start D until C’s acceptance criteria pass on **both** native and
the TypeScript interpreter. A and B must not wait on C.

---

## Cross-cutting constraints (every build)

From the design — treat as non-negotiable while planning:

- **Runtime ABI** (`mn_`*) ≠ **Platform API** (`stdlib/`); apps never call `mn_`*.
- **Runtime ABI ≠ foreign C FFI ABI** (name the inequality; full FFI ABI is a
later/separate spec).
- **Menard is the default; native must justify** (correctness of dual-hosted
meaning, or measured hot path).
- **Fixed point** (`bc0 == bc1`) stays about compiler emission — not concurrent
interleavings.
- Seam modules that declare `extern` stay confined (`sys` / `io` / `fs` /
`proc` / `time`, plus future socket modules as decided).

---

## Build A — Platform foundation

**Maps to design:** §3.12 phases 1–2; §1–2 ratification stance.

### Depends on

| Input | Source |
|---|---|
| Architecture for purpose + libraries | [design §1–2](libraries-concurrency.md) |
| Current seam + stdlib | `stdlib/`, `runtime/`, [stdlib.md](../stdlib.md) |
| Existing dual host (C + TS interpreter) | repo as of today |

**Does not depend on:** suspension, tasks, actors, or Build C+.

### Goal

Make the Platform API the place capability grows: catalogue and tidy the Runtime
ABI, wrap it in `stdlib`, and add foundational Menard libraries — **time**,
**JSON**, and **paths** (filesystem paths and URL-shaped strings) — without
touching concurrency.

### Scope (planning targets)

1. **Formalise** `mn_`*
   - Inventory current `extern` / runtime symbols vs wrappers in `std/sys`,
    `io`, `fs`, `proc`.
   - Document naming, error mapping (`IoError`, spawn errors), and “no `pub`
   extern” as the standing contract.
   - Fill gaps only when Menard cannot express the capability.
2. **Expand** `stdlib/` **in Menard** (one deliverable; Menard-first; `mn_`* only for OS)
   - `std/time` — time, time zones, POSIX timestamps; duration / formatting
    as needed by tools and later HTTP. (“Clock” apps are examples on this API.)
   - `std/json` — encode/decode in one module; dedicated value ADT with
   numbers as both `Int` and `Float`. Native only if justified later.
   - `std/path` — pure `\|>`-friendly join/split/normalise for **POSIX**
   filesystem paths; parse/build URL-shaped strings (scheme, host, path,
   query) as needed. No Windows path rules in A.
3. **Docs**
   - Runtime ABI inventory under `docs/` (enrich over time).
   - Update [stdlib.md](../stdlib.md) (and guide as needed) for new modules.
   - Ratify purpose + library philosophy in [decisions.md](../decisions.md) /
   [menard-spec.md](../menard-spec.md) **in this build**.

### Out of scope

- `Task` / `Mailbox` / `Actor`
- TCP/HTTP (sockets are Build F)
- FFI to third-party C (that is Build B)
- Changing GC or introducing park points
- New integer / float width types (see Build B — not required for A)

### Done when

- [x] Runtime ABI inventory written under `docs/` and wrappers match it.
- [x] `std/time`, `std/json`, and `std/path` land together with `@test`
  ```
  coverage (corpus only for any new `mn_*`).
  ```
- [x] `stdlib.md` lists the new Platform API surface.
- [x] Purpose + library philosophy ratified in `decisions.md` / spec as needed.
- [x] No new public `extern`; seam confinement preserved.
- [x] Bootstrap / corpus still green; `bc0 == bc1` unaffected.

### Results / outputs (feeds later builds)

| Output | Used by |
|---|---|
| Documented `mn_*` + Platform wrappers (`docs/`) | B (FFI boundary clarity), C–F (I/O wrappers) |
| `std/time`, `std/json`, `std/path` | F (HTTP URLs/paths), apps, tooling |
| Habit: Menard-first stdlib growth | All later builds |
| ADR: purpose + libraries ratified (in A) | Spec sync in A |

### Decisions (Stage A planning)

| # | Decision |
|---|---|
| 1 | **Modules:** `std/time`, `std/json`, `std/path`. “Clock” is not a std module name. |
| 1A | **Time zones v1:** UTC + fixed offsets only; no IANA database. |
| 2 | **JSON:** single module `std/json` (encode and decode together). |
| 2C | **Clock seam:** `mn_now_ms` lives in `std/time` only; removed from `std/fs`; call sites updated. |
| 3 | **JSON values:** dedicated ADT; numbers as both `Int` and `Float` (integer token fitting `Int` → `JsonInt`, else `JsonFloat`). |
| 4 | **Time / seams:** maximise Menard. `mn_`* only for OS contact. |
| 5 | **Path/URL API:** pure `\|>` functions; **POSIX only** in v1. |
| 6 | **Ratification:** purpose + library philosophy in `decisions.md` / `menard-spec.md` **as part of Build A**. |
| 7 | **Delivery:** one deliverable — time, JSON, and paths together. |
| 8 | **Ordering:** plan and implement the three libraries together. |
| 9 | **Runtime ABI inventory:** under `docs/` ([runtime-abi.md](../runtime-abi.md)). |
| 10 | **Tests:** `@test` first; corpus only for `mn_`*. |

---

## Build B — FFI proving ground

**Maps to design:** §3.12 phase 3; §2.2 Runtime ABI ≠ C FFI ABI.
**Follow-on (link into** `./mn`**, packages):** [design-ffi.md](ffi.md)
(iterate after the concurrency track).

### Depends on

| Input | From |
|---|---|
| Clear Runtime ABI vs Platform API | **Build A** |
| Dual-hosted linking story | Existing runtime / `mn` driver |
| Design rule: tagged Menard values ≠ raw C layout | design §2.2 |

**Does not depend on:** Build C (concurrency).

**Soft dependency:** A’s ABI inventory makes B cleaner; if B must start early,
at least document the inequality and conversion boundary first.

### Goal

Prove that Menard can call **foreign** native code through an explicit
conversion layer, without treating `mn_*` as the general FFI calling convention.
**Chosen proving ground:** SQLite
([examples/ffi/sqlite/](../examples/ffi/sqlite/)) — cross-platform, no TCC /
`.app` baggage (EventKit Reminders was tried and rejected for product use;
use an external CLI such as remindctl if you need Reminders).

### Language types vs FFI (standing recommendation)

**Do not add** `Byte`**,** `Int16`**,** `Int32`**,** `Int64`**,** `Float32`**,** `Float64`**, … as Menard
types for FFI.** That would reopen settled decisions (one `Int`, no `Byte`,
boxed `Float`) and multiply the dual-host agreement surface.

FFI assists by **converting at the boundary**, not by growing the core type
system:

| Menard | Typical C side (in the bridge) |
|---|---|
| `Int` | `int32_t` / `int64_t` / `size_t` with explicit range checks |
| `Float` | `double` (and narrow to `float` only in the bridge if a lib demands it) |
| `Str` | `const char*` + length, or owned buffer copy |
| `Char` | already a scalar — map to Unicode code point / `uint32_t` as needed |
| `Bool` / `Unit` | C bool / void |

Wide C integers that do not fit Menard `Int` (63-bit tagged) need an explicit
policy in the bridge (truncate with check, `Result` error, or multi-word blob as
`Str`/bytes) — **not** a new language integer type in Build B.

Revisit new widths only as a **separate language ADR** if FFI proves unbearable
without them; that is outside this buildout’s default path.

### Scope (ships)

1. Proving-ground library: **SQLite** (open / exec / query / close).
2. Minimal FFI bridge: pure C ABI (`sql_bridge`) + `MnWord` conversion

   (`sql_ffi`); ownership = copy into `Str`, free C buffers in the bridge.
3. External tree: [`examples/ffi/sqlite/`](../examples/ffi/sqlite/)

   (stays out of `stdlib/`).
4. `/ffi/` modules may declare non-`mn_*` `extern`; seam stays `mn_*`-only.
5. Emit declares FFI prototypes (open path); `sqlite-native` links

   `libsqlite3` (not global `RUNTIME_LIB_SRCS`).
6. Tests: native smoke via `./build/sqlite demo`; interpreter unbound.

### Out of scope

- General package manager / lockfile
- Making SQLite part of `stdlib/`
- Full FFI specification for all C types
- **New Menard numeric / byte types** (see above)
- Concurrent access; C→Menard callbacks (deferred to C/D)
- In-process EventKit / Reminders (use an external helper CLI if needed)

### Done when

- [x] One real foreign library callable from Menard on the native path.
- [x] Interpreter story defined (unsupported / unbound) without lying about
  ```
  agreement.
  ```
- [x] Written note: conversions are explicit; `stdlib` does not poke tagged
  ```
  words by hand.
  ```
- [x] No leakage of SQLite into the Runtime ABI as if it were `mn_*`.

### Results / outputs (feeds later builds)

| Output | Used by |
|---|---|
| FFI conversion patterns | Future native hot paths; optional later DB actors (E/F) |
| Proof that Platform can grow outside `mn_*` | Confidence for A-style growth |
| Constraints on callbacks into Menard | **Build C/D** (single-mutator: no foreign thread runs Menard heap code) |

### Decisions (Stage B)

| # | Decision |
|---|---|
| 1 | Proving ground: **SQLite** (cross-platform; replaces EventKit Reminders). |
| 2 | Live under `examples/ffi/sqlite/`. |
| 3 | Buffer ownership: copy into `Str`; free in bridge. |
| 4 | Interpreter: hard unbound error; native-only. |
| 5 | C→Menard callbacks deferred until C/D. |
| 6 | Link: system `libsqlite3`; dedicated `sqlite-native` Makefile target. |
| 7 | API: open / close / exec / query (JSON rows). |
| 8 | No new core types; SQL text and paths are `Str`. |

---

## Build C — Suspension hard gate (production)

**Maps to design:** §3.12 phase 4; §3.5 / §3.5.1; §3.0 invariants 1–2, 5.  
**Mechanism write-up:** [build-c-suspension.md](builds/c-suspension.md).

### Depends on

| Input | From |
|---|---|
| Dual hosts + GC + shadow stack | Existing runtime / interpreter |
| Shared `Ref` allowed (no `Sendable`) | design §3.7 |
| Single-mutator + GC-visibility invariants | design §3.0 |
| Optional: stable Platform I/O for the experiment harness | **Build A** (nice-to-have, not required) |

**Does not depend on:** Build B (FFI).  
**Blocks:** Builds D, E, F.

### Goal

Ship production suspend/resume on **both** hosts, with GC correctness and shared
mutable state, **before** public Task APIs (hard gate for D — not throwaway code).

### Scope (planning targets)

Implement the D-shaped scheduler + dual-host park (internal / not Platform API):

1. Create multiple lightweight tasks.
2. Suspend inside a **nested** call.
3. Run another task while the first is suspended.
4. **GC** while suspended.
5. Resume; locals and shared `Ref` / `StringBuffer` still correct.
6. One task **terminates** while another is waiting to join it.
7. Same program (or twin) on TypeScript interpreter with matching

   **observable** behaviour (not identical scheduler internals).

Document the chosen suspension representation (stackful vs state machine vs
continuations) and why it works on both hosts.

### Out of scope

- Public `Task.spawn` / `join` Platform API (that is D)
- Mailboxes / actors
- TCP/HTTP
- Final atomic-wait API spelling (guarantee may be stubbed for the experiment)
- Fairness / yield policy beyond what the experiment needs

### Done when

- [x] All §3.5.1 bullets pass natively under GC stress where applicable
  ```
  (`MENARD_GC_STRESS` / heap verify as appropriate).
  ```
- [x] Interpreter passes the equivalent scenario.
- [x] Short write-up: mechanism choice, known limitations, what D can rely on
  ```
  ([build-c-suspension.md](builds/c-suspension.md)).
  ```
- [x] Explicit list of **temporary** internal APIs that must not ship as Platform
  ```
  API yet (same write-up).
  ```

### Results / outputs (feeds later builds)

| Output | Used by |
|---|---|
| Proven suspend/resume + GC story on both hosts | **D** (scheduler) |
| Mechanism: per-task roots; native fibers + interpreter Cont[] | **D** |
| Evidence shared `Ref` across park works | **D**, **E** (mailboxes) |
| D-shaped `mn_task_*` + `std/sched` (internal) | **D** |

### Decisions (Stage C)

| # | Decision |
|---|---|
| 1 | Dual mechanism, unified observables: native task-local fibers (`ucontext`); interpreter `Cont[]`. |
| 2 | Per-task shadow stacks; GC visits all tasks + `mn_task_visit_roots`. |
| 3 | D-shaped scheduler skeleton in `runtime/src/task.c` + `host/src/interp/task.ts` (not disposable). |
| 4 | Acceptance suite under `tests/suspend/`. |
| 5 | Synthetic `mn_task_suspend_for_test` (no parkable I/O in C). |
| 6 | Join is real `mn_task_join` (main only in C); auto-resume if join would deadlock. |
| 7 | Both hosts must pass; golden on observables only. |
| 8 | Internal seam `std/sched` — not Platform API until D. |

---

## Build D — Task runtime + public `Task.*`

**Maps to design:** §3.12 phases 5–6; §3.0; §3.3.2; §3.10.1.

### Depends on

| Input | From |
|---|---|
| Proven suspension + GC + shared `Ref` | **Build C** (required) |
| No public wake; internal scheduler vs Platform API | design §3.3.2 |
| Cancel-aware wait semantics (design intent) | design §3.10.1 |
| Single-mutator / no lost-wakeup **guarantees** | design §3.0 |

**Does not depend on:** Build E (actors) or F (TCP).  
**Blocks:** E, F.

### Goal

Turn the experiment into a real cooperative single-mutator scheduler and a
public `std/task` (or equivalent) API: spawn, join, scope, yield — **not** raw
park/wake.

### Scope (planning targets)

1. **Internal runtime:** create / atomic-wait *guarantee* / resume / cancel;

   runnable queue; document that wake is not Platform API.
2. **Public Platform API:** `Task.spawn`, `Task.join`, `Task.scope` (structured

   lifetimes), `Task.yield`; catalogue **which** operations may suspend.
3. **Cancellation:** defined outcomes for join (and stubs for future

   receive/I/O cancel).
4. Tests: multi-task, shared `Ref`, cancel of a parked join, yield fairness

   smoke.
5. Dual-host semantic agreement tests (ordering guarantees as specified).

### Out of scope

- `Mailbox` / `Actor` (Build E)
- Parkable TCP/HTTP (Build F)
- Bounded mailboxes / supervision trees (Build F)
- Exposing `Task.wake` publicly

### Done when

- [x] Public Task API usable from Menard on native + interpreter.
- [x] Atomic-wait **guarantee** held by tests (mechanism may be internal).
- [x] No public park/wake.
- [x] Suspend-point catalogue started (even if incomplete).
- [x] Cancel + scope behaviour specified and tested for join at minimum.
- [x] Design §3.0 invariants 1–4 demonstrably respected in tests.

### Results / outputs (feeds later builds)

| Output | Used by |
|---|---|
| `std/task` + internal scheduler | **E** (actor = task + mailbox), **F** |
| Cancel hooks | **E**, **F** (receive / accept cancel) |
| Suspend catalogue | **F** (document I/O) |
| Single-mutator discipline | **E**, **F**, future FFI callbacks |

### Decisions (Stage D)

| # | Decision |
|---|---|
| 1 | Platform: `std/task`; internal harness/wait cells: `std/sched`. |
| 2 | `Task.join` → `Result a Cancelled`; `Task.cancel` public. |
| 3 | `Task.scope` + `Task.spawn-in` + bare `Task.spawn`. |
| 4 | Atomic wait = runtime wait cells (sticky notify + single waiter); not Platform API. |
| 5 | `type Task[a] = Tid(Int)`; debug via `Task.id`. |
| 6 | Cooperative `Task.yield` only; no priorities in D. |
| 7 | Join from any task. Write-up: [build-d-tasks.md](builds/d-tasks.md). |

---

## Build E — Mailbox + Actor

**Maps to design:** §3.12 phase 7; §3.3.3; §3.6–3.8; §3.10.2.

### Depends on

| Input | From |
|---|---|
| Public tasks + cancel + atomic wait | **Build D** (required) |
| Shared `Ref` for queue storage | design §3.7; proven in **C** |
| Actors as abstraction, not isolation | design §3.6 |
| `Actor.call` ergonomics intent | design §3.8 |

**Does not depend on:** Build F (can unit-test actors without TCP).  
**Blocks:** F’s “actorful” server patterns (F can still do bare tasks + TCP).

### Goal

Implement message queues and actors **in Menard** on the task runtime: identity,
serialised receive loop, send/call, lifecycle by convention.

### Scope (planning targets)

1. `std/mailbox`**:** `Ref`-backed queue (two-list or similar); receive uses

   runtime atomic wait; cancel-aware receive.
2. `std/actor`**:** spawn (task + mailbox loop), send, call (hide reply-Pid

   plumbing if possible), self/Pid.
3. Document: not an isolation boundary; shared `Ref` across tasks allowed.
4. Example: UserManager-style service in `examples/`.
5. Initial lifecycle rules: death, message-after-death, panic visibility

   (may be minimal but written down).

### Out of scope

- Bounded mailbox / backpressure (Build F / phase 9 — may stub)
- Full supervision trees (Build F)
- HTTP (Build F)
- Native mailbox optimisation unless D/E profiling demands it

### Done when

- [x] Mailbox send/receive correct under concurrent senders (cooperative).
- [x] No lost wakeup in mailbox tests.
- [x] Actor example + tests for put/get/search-style protocol.
- [x] `Actor.call` usable without forcing every protocol to expose reply Pids
  ```
  (`Ask[req, res]` + `call` / `serve*`).
  ```
- [x] Lifecycle behaviour documented even if v1 is simple.

### Results / outputs (feeds later builds)

| Output | Used by |
|---|---|
| `std/actor` (Mailbox + Actor) | **F** (HTTP gateway → domain actors) |
| Example service patterns | Apps / guide |
| Lifecycle hooks sufficient for supervision | **F** |

### Decisions (Stage E)

| # | Decision |
|---|---|
| 1 | One module: `std/actor` (Mailbox folded in). |
| 2 | Two-list unbounded queue. |
| 3 | Phantom `Pid[a]`. |
| 4 | Typed `Actor.call` via `Ask[req, res]` (no reply Pid in user ADTs). |
| 5 | Message-after-death → error to sender (`ActorDead`). |
| 6 | Cancel/failure: kill actor + escalate nursery. |
| 7 | Simple name registry in E (`register` / `whereis`). |
| 8 | Multi-waiter mailboxes; notify wakes one. |
| 9 | Cancel-returning `mn_task_wait` (`Result`); receive observes `ActorCancelled`. |
| 10 | Write-up: [build-e-actors.md](builds/e-actors.md). |

---

## Build F — Network, resource cleanup, supervision

**Maps to design:** §3.12 phases 8–9; §3.4; §3.10.1a; §3.10.2 overload.

### Depends on

| Input | From |
|---|---|
| Parkable / cancel-aware task waits | **Build D** (required) |
| Preferably actors for domain services | **Build E** (strongly recommended) |
| JSON (and ideally time) | **Build A** |
| Resource lifetime requirement | design §3.10.1a |
| Sync-looking I/O model | design §3.4 |
| FFI single-mutator callback rules if using C libs | **Build B** (if applicable) |

**Does not unlock further architecture builds** in this plan — this is the
capstone of the concurrency initiative (further work is product).

### Goal

Ship cancel-aware **sockets** at the Runtime ABI / thin Platform wrapper, then
implement **HTTP, HTTPS, and REST-style client/server in Menard** on top — not
as a large C HTTP stack. Harden mailboxes (bounds/backpressure) and basic
supervision so long-running services are credible.

### Layering (correct reading of the design)

```
REST / HTTP client & server     ← Menard (stdlib and/or Menard libraries)
        │
HTTPS (TLS record + HTTP)       ← Menard over TLS stream  (TLS itself: see Qs)
        │
TCP / UDP sockets               ← mn_* seam + thin std wrappers (parkable)
        │
OS
```

- **Native / C:** socket primitives (and possibly a TLS backend via `mn_`* or
FFI) — irreducible OS contact and park/completion.
- **Menard:** HTTP/1.x (and REST conventions), routing, codecs (JSON from A),
client and server APIs, HTTPS as HTTP-over-TLS from Menard’s point of view.

This matches “small OS interface; everything possible in Menard.”

### Scope (planning targets)

1. **Sockets (native seam +** `std` **wrappers):** listen/accept/connect/read/write/

   close; parkable; cancel-aware; completions via scheduler (no worker-thread
    Menard).
2. **Resource cleanup:** `with-connection`-style (or equivalent) so cancel

   still closes FDs.
3. **HTTP client + server in Menard** on sockets (foundational → prefer

   `stdlib` / adjacent std modules; decide naming in planning).
4. **HTTPS / REST in Menard** — REST as conventions over HTTP; HTTPS needs a

   TLS byte-stream under HTTP (native/FFI TLS engine vs pure Menard — open).
5. **Suspend catalogue** updated for all new I/O.
6. **Supervision / backpressure:** bounded mailboxes; minimal supervisor or

   documented patterns; load test smoke for UserManager-under-load class bugs.

### Out of scope

- Shared-heap multicore
- Full web framework / ORM (Menard libraries later)
- Implementing HTTP framing in C
- Process-control sprawl (signals, etc. — still refused)

### Done when

- [x] Accept/connect loops + per-connection tasks work under cancel/shutdown.
- [x] Resource cleanup verified on cancel paths (`defer` + cancel).
- [x] Menard HTTP **server** and **client** minimal path (HTTP/1.1 subset).
- [x] REST-style example (e.g. JSON resource over HTTP) in Menard.
- [x] HTTPS path defined: OpenSSL via `mn_tls_*` (see [build-f-network.md](builds/f-network.md)).
- [x] Example: HTTP ↔ actor UserManager (or equivalent).
- [x] Bounded mailbox (block-on-full, default 1024).
- [x] Dual-host: native required; interpreter unbound for net/TLS (no false agreement).

### Results / outputs

| Output | Used by |
|---|---|
| Socket Platform API + Menard HTTP(S)/REST | Applications in Go/Deno/Bun domain |
| Cleanup patterns | All future OS resources |
| Supervision/backpressure | Production services |
| Feedback into design/spec ratification of concurrency | `decisions.md` / spec when ready |

### Decisions (Stage F)

Recorded in [build-f-network.md](builds/f-network.md): `std/net` (TCP+UDP),
`std/http` + `std/rest`, OpenSSL `mn_tls_*`, language `defer`, native-only net,
block-on-full mailboxes (1024), `std/supervisor` one-for-one helpers.

---

## Dependency diagram

```
                    ┌─────────────┐
                    │  Design doc │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
        ┌──────────┐              ┌──────────┐
        │ Build A  │─────────────▶│ Build B  │
        │ Platform │   (ABI clear)│   FFI    │
        └────┬─────┘              └────┬─────┘
             │                         │
             │         ┌───────────────┘
             │         │ (callback rules only)
             ▼         ▼
        ┌──────────────────┐
        │     Build C      │  ← HARD GATE (production)
        │  Suspension      │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │     Build D      │
        │  Task runtime    │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │     Build E      │
        │ Mailbox + Actor  │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │     Build F      │
        │ Net + cleanup +  │
        │  supervision     │
        └──────────────────┘
```

A → C is optional (harness convenience). B → C/D is informational (FFI
callbacks). **C → D is mandatory.**

---

## Suggested planning order

1. Plan and schedule **Build A** immediately (ratify purpose/libraries; ship

   `std/time` + `std/json` + `std/path` as one deliverable).
2. Slot **Build B** when FFI bandwidth exists (parallel to A tail, or after A).
3. Do **not** staff D/E/F until **Build C** has a written mechanism choice and

   passing acceptance criteria.
4. After C: D then E then F in sequence (E may overlap late D only if Task API

   is stable enough for mailbox prototypes).

---

## Related documents

| Document | Role |
|---|---|
| [design-libraries-concurrency.md](libraries-concurrency.md) | Architecture (source of truth) |
| [stdlib.md](../stdlib.md) | Current Platform API catalogue |
| [decisions.md](../decisions.md) | Ratification / ADRs |
| [menard-spec.md](../menard-spec.md) | Normative language (update only after ADR) |
| [runtime-abi.md](../runtime-abi.md) | Seam `mn_*` inventory (Build A) |
| [build-c-suspension.md](builds/c-suspension.md) | Build C mechanism + temporary APIs |
| [build-d-tasks.md](builds/d-tasks.md) | Build D Task API + wait cells + cancel |
| [build-e-actors.md](builds/e-actors.md) | Build E Mailbox + Actor + lifecycle |
| [build-f-network.md](builds/f-network.md) | Build F defer + net + HTTP + supervision |
| [runtime/README.md](../../runtime/README.md) | C runtime layout |
