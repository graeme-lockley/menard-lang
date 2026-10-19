# Design: purpose, libraries, concurrency, and runtime

**Status:** architecture complete — stop general design revision; implement.
Does not amend [menard-spec.md](menard-spec.md) until ratified into
[decisions.md](decisions.md) and the specification.

External review (final): approve this design and move to implementation.
Remaining uncertainty is predominantly **implementation**, not architecture.
Do not commission another general rewrite of this document.

### Ratification and build stance

| Part | Stance |
|---|---|
| §1 Purpose | **Ratify now** — no further design changes |
| §2 Library philosophy | **Ratify now** — Runtime ABI ≠ Platform API; stdlib breadth evolves in code |
| §3 Concurrency | **Approved as implementation direction**; remains *formally* provisional until the Phase 4 suspension experiment succeeds — not a contradiction |
| §4 Runtime impact | Follows from §2; concurrency machinery follows §3 after Phase 4 |

**Two initiatives (do not couple them):**

1. **Ratify purpose + libraries and build the Platform API** — extend `mn_*`, grow `stdlib/` (Phases 1–3). **Start here.**
2. **Concurrency track** — Phase 4 experiment, then scheduler / Task / mailbox / actor (Phases 5–9). Architecture settled; feasibility unproven until §3.5.1 passes.

This document captures the direction for Menard’s next epoch. The dependency
order is deliberate and was affirmed in review:

```
purpose  →  library philosophy  →  concurrency model  →  runtime shape
```

The runtime is not designed in isolation. It is the smallest machine that makes
the library philosophy true.

---

## 1. Evolution of purpose

### 1.1 Where Menard started

Menard began as a language whose interesting claim is **agreement**: one compiler
text, two worlds (TypeScript interpreter and native code linked to a C runtime),
identical artifacts (`bc0 == bc1`). The early product was the self-hosted
compiler and the tooling that builds it. That forced a narrow host seam
(filesystem, environment, argv-vector spawn), a deterministic emission story, and
a small dual-implemented runtime.

Standing non-goals in the current specification include: concurrency/threads, a
package manager, FFI beyond libc, and “not a general-purpose systems language.”
Those were correct *for finishing the fixed point*. They are not a permanent
product ceiling.

### 1.2 Where Menard is aimed

The intended domain overlaps **Go, Deno, and Bun**: command-line tools, network
services, scripts that talk to the OS without becoming C, and libraries written
in the language itself.

That does not mean copying those runtimes. It means Menard should be a credible
language for that *class of programs*, with:

- a **small OS / runtime ABI**,
- a **rich library layer written in Menard** (a small runtime does *not* imply a
  small standard library),
- and, when concurrency lands, **in-process concurrency** that does not rely on
  `async`/`await` colouring.

Process spawn (`std/proc`) remains part of the story (build drivers, toolchains).
It is not enough for highly concurrent I/O servers on its own.

### 1.3 The governing slogan

> Don’t build a large runtime. Build a small, well-defined operating-system
> interface and then force yourself to implement everything possible in Menard.

**Long-term engineering reading (not dogma about C line count):**

> **Native code must justify its existence. Menard code is the default.**

Hot paths (JSON, crypto, buffers, …) may later earn specialised native code under
the placement rule — that is justified growth, not failure. Measuring success by
“smallest possible `runtime/`” alone is the wrong scoreboard.

Slightly sharpened for concurrency:

> Irreducible **cooperative scheduler and atomic wait** in the runtime
> (internal); public **Task**, **Mailbox**, and **Actor** in `stdlib` — shared
> `Ref` under one mutator, no `Sendable`, not raw wake, not futures, not a
> native actor subsystem.

### 1.4 What this document changes when ratified

| Topic | Current spec stance | Intended direction |
|---|---|---|
| Purpose | Compiler + narrow host seam | Same foundation; product lane toward Go/Deno/Bun-shaped programs |
| Libraries | `stdlib/` + `github:` import form | Explicit stack; Runtime ABI ≠ Platform API; richer std possible if still Menard |
| Concurrency | Non-goal (single-threaded STW) | **Provisional** — cooperative single mutator; shared `Ref`; no `Sendable`; tasks/mailboxes/actors as in §3 |
| Runtime growth | Dual-implemented, kept small | Still small; grow `mn_*` first; internal scheduler + atomic wait after suspension experiment — not a native actor/mailbox runtime |

Ratification means dated entries in `decisions.md` and normative edits to the
specification — not this draft alone. Prefer ratifying purpose and libraries
**now**; keep concurrency as a separate decision.

---

## 2. Library philosophy

### 2.1 The stack

```
APPLICATIONS
      │
MENARD LIBRARIES          github:owner/repo@version/…  (locator in source)
      │
STANDARD LIBRARY          stdlib/*.mnd  via  import std/…   ← Platform API
      │
MENARD NAMESPACE          language surface + runtime decls
      │
C RUNTIME                 mn_* symbols, GC, values          ← Runtime ABI
      │                       (+ TypeScript interpreter twin)
OPERATING SYSTEM
```

**Applications** — user programs; the compiler in `src/` is the prime one today.

**Menard libraries** — external packages. The import form is already specified
(`github:…` → `~/.menard/deps`). Integrity/lockfile/registry remain open; a full
package manager is not required for the layering to be right.

**Standard library** — ordinary Menard under `stdlib/`. The **Platform API**:
what Menard programs are entitled to depend on. One version story with the
language for now (avoid splitting std into independently versioned units until
forced).

**Menard namespace / Runtime ABI** — the owned native contract, *not* a Deno-style
ambient global object. Prefer **`mn_*`** over a `Menard.` namespace: C-legal,
greppable, never `pub`, confined to seam modules.

| Kind | Examples | App-visible? |
|---|---|---|
| Built-in types | `List`, `Map`, `Maybe`, `Result`, `Str`, `Ref`, `StringBuffer` | Always |
| Compiler-known | `show`, `print`/`println`, `=`, `compare`, `dump` | Ambient |
| Runtime-backed | string/map/buffer ops | Usually via `std/…` |
| Link symbols | `mn_fs_open`, `mn_write`, `mn_exit`, … | **Never `pub`**; only seam modules declare `extern` |

**C runtime** — values, GC, irreducible builtins, and OS wrappers. Mirrored by
the interpreter. Every line here is paid twice and must agree.

### 2.2 Two contracts (formalise this)

The C ABI and the public Menard platform API are **not** the same thing.

| Contract | Purpose | Example |
|---|---|---|
| **Runtime ABI** | How compiled Menard (and the interpreter) interact with the native runtime | `mn_fs_open`, `mn_fs_read`, `mn_fs_close` |
| **Platform API** | What capabilities source programs depend on | `import std/fs as Fs` → `Fs.open`, `Fs.read`, `Fs.close` |

This separation:

- Lets the C runtime evolve without breaking source compatibility.
- Becomes load-bearing when FFI, dynamic linking, and third-party native code
  appear.
- Matches the existing pattern (`extern mn_*` private; `pub let` wrappers).

**Runtime ABI ≠ foreign C FFI ABI.** Menard values are tagged and GC-managed;
libc uses native representations. Future FFI must convert explicitly
(`Str` ↔ `char*`, `Int` ↔ `int`, …) in a small FFI layer — programs and most of
`stdlib` must not hand-manipulate tagged words. Keep `mn_*` as the *Menard
runtime* contract, not as the general “call any C” calling convention.

### 2.3 Placement rule (unchanged, restated)

From §2.8 / ADR 28 — the filter for every new capability:

| Tier | Rule | Implemented |
|---|---|---|
| Compiler-known | Needs per-type synthesis or special typing | Twice |
| Runtime-backed | Needs mutation/opaque representation **and** a named hot client | Twice |
| Prelude / stdlib | Expressible in Menard | Once |
| Host seam | Touches the OS | Twice (`mn_*` + interpreter host) |

**Whatever is implemented twice belongs in the specification.** Everything else
is Menard source.

Ask in order:

1. OS contact? → `mn_*` + wrapper in the Platform API (or refuse).
2. Opaque mutation / heap **and** justified client? → runtime-backed + `std/` façade.
3. Expressible in Menard? → default to Menard (`stdlib/` if foundational platform
   vocabulary; Menard library if specialised / vendor / framework). Native only
   with a concrete justification (correctness or measured hot path).
4. Would ambient/`basics` steal names from data libs? → keep auto-import tiny.

### 2.4 Breadth of `stdlib/` — open but leaning richer

**A small runtime does not imply a small standard library.** Rich libraries
written in Menard are part of what makes the Go/Deno/Bun domain attractive.

Earlier draft put HTTP, JSON, and SQLite all outside `std/`. Review pushback
accepted in part:

| Prefer in **standard library** (Menard) | Prefer as **external** Menard libraries |
|---|---|
| Collections, strings, maps | SQLite, PostgreSQL |
| Filesystem, processes, env | ORMs, app frameworks |
| Time | Cloud SDKs |
| JSON (foundational format) | Specialised protocols |
| TCP/UDP + HTTP (foundational protocols) | Full web frameworks on top of HTTP |

**Still true:** none of that forces a larger *native* runtime if implemented in
Menard on top of a small `mn_*` seam (sockets, etc.).

**Still refuse:** a second “compat” std beside Menard’s own (Bun/Deno two-stds
failure mode).

Exact membership of JSON/HTTP in `std/` vs `github:` is an open product call
(§5); the principle is “foundational formats and protocols may live in std if
they are Menard.”

### 2.5 Deno’s lesson, Menard’s accent

Deno splits **low-level platform ops** from **libraries**. Menard takes the
*layering*, not the ambient global:

- low-level = Runtime ABI (`mn_*` + irreducible value/GC ops),
- Platform API = `stdlib/`,
- optional packages = `github:…`,
- apps import Menard modules; they do not call `mn_*` directly.

### 2.6 Markers and boundaries

- `!` marks **observable mutation** of a held value only (`set!`, buffer mutators).
- The OS boundary is **`extern`**, confined to seam modules (`sys`, `io`, `fs`,
  `proc`, and future socket modules as needed).
- `std/basics` stays the only implicit import and stays small.
- Data-last for pipes; cell or path first when the subject is a mutable cell or
  a filesystem path.
- Failure is `Result` with closed taxonomies at the seam — never `strerror` as API.

### 2.7 What “force yourself to implement in Menard” means in practice

Grow capability by writing `.mnd`. Resist new C unless Menard cannot express it,
or cannot afford it on a hot path with a named client. The compiler justified
`StringBuffer` and argv spawn; future builtins need the same bar.

---

## 3. Concurrency (architecture approved; formally provisional until Phase 4)

> **Approved as implementation direction.** Do not reopen the architecture.
> Formally provisional only until the Phase 4 suspension experiment succeeds.
> Working lean: cooperative **single-mutator** tasks; mailboxes and actors in
> `stdlib`; **shared `Ref` / `StringBuffer`** (no `Sendable`). Five invariants
> below; resource cleanup before networking (§3.10.1a).

### 3.0 Five invariants (concurrency ratification blockers)

**Concurrency ≠ parallelism.** Initial Menard concurrency is cooperative I/O
concurrency on one mutator — not shared-heap multicore execution of Menard code.

1. **Single-mutator execution** — only one task executes Menard instructions at
   any instant. Switching only at defined suspension or yield points (not
   arbitrary preemption). Broaden: **all execution that can access or mutate the
   Menard heap is serialised through that single-mutator context** (FFI
   callbacks into Menard, I/O completions, …). Completions are delivered via the
   scheduler — not by running arbitrary Menard from worker threads. A native
   function must not silently pump the scheduler inside an operation documented
   as non-suspending.
2. **Non-interleaving between suspension points** — a sequence of Menard
   operations that neither suspends nor yields runs without another Menard task
   interleaving. Built-in mutation (`set!`, buffer appends, …) must not insert
   hidden scheduling points that break their documented atomicity.
3. **No lost wakeups** — registering interest and suspending is atomic w.r.t.
   notifications (§3.3.3).
4. **Defined cancellation and lifetimes** — structured scopes; parkable waits
   define cancel behaviour (§3.10.1).
5. **Complete GC visibility** — all live values remain rooted across suspension
   (running/suspended tasks, mailboxes, scheduler queues, pending I/O) (§3.5.1).

**Deliberately not an invariant:** compile-time isolation via `Sendable`. See
§3.7 for the rationale and the trade-off against future shared-heap parallelism.

### 3.1 Why concurrency enters

Without *in-process* concurrency, Menard stays awkward in the Go/Deno/Bun lane.
Process spawn stays; it is not the whole story.

Concurrency is **not** a stdlib sprinkle. Irreducible parts are runtime. That
sits in tension with the slogan — resolved by: **small suspension / schedule /
atomic-wait core; tasks, mailboxes, and actors predominantly in Menard.**

### 3.2 Rejected (surface and memory model)

| Model | Verdict |
|---|---|
| `async`/`await` + coloured functions | **Rejected** as surface — viral notation; fights “no effect system” |
| Futures/promises in the type system | **Rejected** as the default programming model |
| OS thread per request | **Rejected** — poor scaling; wrong unit of concurrency |
| `Sendable` / ownership for task isolation (initial design) | **Rejected for v1** — disproportionate; blocks Menard mailboxes (§3.7) |
| Shared-heap multicore Menard mutators | **Excluded from initial model** — separate architectural decision later |
| Go CSP with shared memory available | Take **ergonomics**; shared `Ref` under single mutator is intentional |

### 3.3 The architectural fork — working lean

Distinguish three concepts:

| Concept | Meaning |
|---|---|
| **Task** | An independently scheduled computation (can suspend/resume) |
| **Actor** | A task with identity, mailbox, and serialised message turns |
| **Message** | A value sent to a mailbox (any Menard value, including `Ref`) |

**Two commitments (different):**

1. **Actors as the only concurrency primitive** — every concurrent activity is an
   actor (even a one-shot “process 10 000 files” job).
2. **Tasks as the runtime primitive; mailboxes and actors in `stdlib`** — tasks,
   shared `Ref`s, and mailboxes are equally legitimate building blocks; actors
   are the preferred *abstraction* for owned state, not the only model.

**Working lean (aligned with the library slogan): (2).**

```
                    APPLICATIONS
                         |
                  MENARD LIBRARIES
                         |
                   STANDARD LIBRARY
                         |
              +----------+----------+
              |          |          |
             Task      Mailbox     Actor
              |          |          |
              +----------+----------+
                         |
                    RUNTIME ABI
                         |
                Cooperative Scheduler
                   Atomic Waiting
                    Cancellation
                    Task Contexts
                    GC / Memory
                    OS / I/O
                         |
                   OPERATING SYSTEM
```

| Concern | Home |
|---|---|
| Scheduler, atomic wait, resume, cancel, I/O park, GC roots | **Runtime** (internal) |
| Public `Task.*` | **`stdlib`** — **no raw `wake`** |
| Mailbox queue storage | **`stdlib`** (`Ref` + queue) + runtime atomic wait |
| `Actor.*` | **`stdlib`** — structured messaging, not isolation boundary |
| Optimised ring-buffer mailbox | Optional later `mn_*` if profiling demands |

**Risk of (1):** every short-lived parallel job becomes an actor protocol.

The fork stays **formally open until a suspension experiment exists**, but design
and examples assume (2) unless that experiment forces otherwise.

### 3.3.1 Public Task surface (illustrative)

No `async`. Application code does **not** call raw park/wake. Suspension is
inside parkable I/O, `Task.join`, `Mailbox.receive`, and similar.

```
let work(path: Str) -> Result Str IoError =
  read-file(path)                    ; may suspend this task

let main() -> Int {
  let t1 = Task.spawn(fn () = work("a.txt"))   ; captures may include Ref (§3.7)
  let t2 = Task.spawn(fn () = work("b.txt"))
  match (Task.join(t1), Task.join(t2))
    | (Ok(a), Ok(b)) -> { println(a); println(b); 0 }
    | _ -> 1
}
```

Shared mutation is allowed under the single mutator (ordering depends on
scheduling; no simultaneous access):

```
let counter = ref(0)
Task.spawn(fn () = set!(counter, deref(counter) + 1))
Task.spawn(fn () = set!(counter, deref(counter) + 1))
```

Fan-out without actors (one-shot work):

```
paths
  |> List.map(fn (p) = Task.spawn(fn () = count-lines(p)))
  |> List.map(Task.join)
```

Structured server lifetime (§3.10.1):

```
Task.scope(fn (scope) {
  loop ()
    {
      let conn = Tcp.accept(listener)
      Task.spawn(scope, fn () = serve-one(conn))
      recur()
    }
})
; scope exit → cancel/join children
```

### 3.3.2 Internal scheduler vs public Task API

A task runs until it **suspends**, **returns**, or optionally **yields**. The
scheduler is cooperative (not OS-preemptive mid-instruction) on a single mutator
for v1 (§3.0 invariants 1–2).

**Do not expose unrestricted `Task.park` / `Task.wake` in the Platform API.**
Encapsulate suspension inside synchronisation and I/O primitives — same
governing principle as hiding `mn_*`.

| Internal Runtime ABI (sketch) | Public Platform API |
|---|---|
| `mn_task_create` | `Task.spawn` |
| `mn_task_suspend` / register-wait | used by `Task.join`, I/O, `Mailbox.receive` |
| `mn_task_resume` | not public; driven by completion / send / cancel |
| `mn_task_cancel` | `Task.cancel` / scope exit |
| scheduler loop | invisible |

Public surface (illustrative): `Task.spawn`, `Task.join`, `Task.yield`,
`Task.scope` / structured spawn, maybe `Task.cancel`. Mailboxes and actors build
on the **internal** wait protocol, not on a user-visible `wake`.

**Fairness:** a task that neither suspends nor yields can monopolise the mutator
(including delaying cancellation). Accept for v1; expose `Task.yield()` for
long CPU work. Compiler-inserted scheduling safepoints are a later investigation;
**GC safepoints must not silently become scheduling points.**

Document which Platform API / `mn_*` operations may suspend — no `async` colour,
but programmers must know where logical interleaving can occur.

### 3.3.3 Mailbox — entirely in Menard + atomic wait

A mailbox is queue storage in Menard **plus** a runtime atomic-wait protocol.

Because the scheduler is cooperative, senders and the receiver may share a
`Ref`-backed queue **without locks**, provided enqueue/dequeue do not suspend.
`Sendable` is not required for the spawned receiver to capture the mailbox.

**Correctness bug in naive register-then-park:**

```
; UNSAFE if park and register are separable
set!(mb.waiter, Some(self))
; — sender can enqueue + "wake" here, before park —
Task.park()        ; wake already happened → lost wakeup; receiver sleeps forever
```

**Invariant (runtime guarantee):** a task must never go to sleep after the
condition it waits for has already been satisfied without retaining a
corresponding notification. Prefer leaving the **API spelling** unspecified until
the scheduler experiment (`park-if(fn)` is especially fraught if the predicate
runs Menard — allocation, nested suspend, …). Specify the **guarantee**, not a
premature mechanism.

Illustrative shape (storage in Menard; wait via runtime):

```
record Mailbox[a] {
  messages: Ref (List a)           ; prefer a two-list queue in practice
  ; waiter / token fields as required by the runtime wait protocol
}

let push[a](mb: Mailbox a, message: a) -> Unit {
  ; non-suspending enqueue, then signal via runtime wait protocol (no public wake)
}

let receive[a](mb: Mailbox a) -> a {
  ; dequeue or atomic wait-until-nonempty (cancel-aware — §3.10.1)
}
```

| Responsibility | Implementation |
|---|---|
| Message queue / types / send-receive logic | **Menard** |
| Actor abstraction / supervision | **Menard** |
| Atomic waiting / suspend / resume / cancel | **Runtime** |

**The runtime provides atomic waiting, not a native mailbox or actor subsystem.**

`Actor.spawn`: create mailbox, `Task.spawn` a loop of `receive` → handler
(capturing the mailbox `Ref`), return a `Pid`. List-as-queue is fine for a first
cut; a native ring buffer is an optimisation, not a prerequisite.

### 3.4 The wait problem — sync-looking I/O as the default

I/O takes time. Spellings differ:

| Style | Surface | Function colouring? |
|---|---|---|
| `async`/`await` | `await read(...)` | Yes |
| Completion messages | `ReadDone` in a mailbox | No |
| Look-synchronous park | `read(...)` looks blocking | No — runtime parks |

**Preferred default programming model:** synchronous-looking I/O (Go-like):

```
let connection = Tcp.accept(listener)
let request = Http.read-request(connection)
let response = handle(request)
Http.write-response(connection, response)
```

The programmer sees ordinary sequential Menard. The runtime suspends the current
**task** (or actor turn) while the operation waits. No Future type in the
surface language.

Completion messages remain a valid *implementation* and a valid lower-level
API; they need not be what application authors write first.

### 3.5 The hard problem: suspension and resumption

> This is the single most consequential *implementation* decision in the
> concurrency proposal — not a reason to reopen the architecture. The actor API
> is comparatively straightforward. Efficient suspension of native Menard
> computations (and the interpreter twin) is the hard part.

No `async` colour means ordinary callers must survive callees that suspend:

```
let process() {
  let a = calculate()
  let b = read-file("data.txt")   ; may suspend; process has no annotation
  let c = transform(a, b)
  c
}
```

To park an arbitrary computation the runtime must preserve:

- call stacks / locals,
- continuations or equivalent,
- GC roots at the suspension point,
- a defined resumption protocol.

**Choose a semantic model that both hosts can implement**, not only what fits
LLVM best. Stackful coroutines may work natively but do not map cleanly onto
ordinary synchronous JavaScript; the interpreter will need frames, continuations,
or state-machine lowering. Implementations need not match; observable behaviour
must (§3.11).

Candidate mechanisms (unevaluated — Phase 4 decides):

- stackful coroutines,
- compiler-generated state machines (stackless),
- explicit continuation capture.

**Gate:** prove the suspension experiment (§3.5.1) **before** committing the
final public Task/Actor API (§3.12).

#### 3.5.1 Suspension experiment — acceptance criteria

A native Menard program must:

1. Create multiple lightweight tasks that **share a `Ref`** (and/or
   `StringBuffer`).
2. Suspend one task inside a **nested** function call.
3. Execute another task while the first is suspended (possibly mutating the
   shared cell).
4. Trigger **garbage collection** while the first task is suspended.
5. Resume the original task.
6. Access its previously live local variables (and the shared `Ref`) correctly.
7. Complete without memory corruption or leaked task resources.

Plus: a task that **terminates** while another is **`join`ing** it (lifecycle
early).

The equivalent program must succeed under the TypeScript interpreter.

This exercises compiler lowering, stack/continuation preservation, GC roots,
scheduling, shared mutation under a single mutator, and dual-host semantics.

### 3.6 Actors — preferred abstraction, not an isolation boundary

Actors provide:

- identity (`Pid`),
- a mailbox,
- serialised message processing (one turn at a time for that actor’s task),
- encapsulation **by convention and API design**,
- request/reply, lifecycle, supervision (mostly in Menard).

Actors do **not** provide statically enforced isolation or a security boundary.
An actor may share a `Ref` with another task; that is allowed. Apps that want
stronger encapsulation keep mutable state private to the actor’s receive loop by
convention.

1. **One kind of function** — no async colour; waiting is join / receive / I/O.
2. **Single activity per actor** — at most one turn of that actor’s task at a
   time (mailbox serialisation).
3. **Protocols are types** — e.g. `UserManagerMsg` *is* the API.
4. **Domain actors, not FS-as-actor-from-the-ground-up** — repositories own
   domain state by design; the filesystem remains Runtime ABI + Platform API.
5. **Tasks remain first-class** — bare tasks, shared refs, and mailboxes are
   legitimate without wrapping everything as an actor.

### 3.7 No `Sendable` — shared mutation under a single mutator

**Decision (provisional concurrency design):** do **not** introduce a `Sendable`
constraint for the initial concurrency model.

#### Why `Sendable` was rejected

`Sendable` was meant to keep `Ref` / `StringBuffer` out of messages and task
captures. That conflicts with Menard mailboxes:

```
record Mailbox[a] { messages: Ref (List a) }
; receiver task must capture the mailbox — a Ref
; send mutates another task's queue — cross-task mutation
```

Fixing that without dropping `Sendable` forces ownership, capability types, or a
native mailbox — complexity disproportionate to a single-mutator runtime.

#### What is allowed

```
let counter = ref(0)
Task.spawn(fn () = set!(counter, deref(counter) + 1))
Task.spawn(fn () = set!(counter, deref(counter) + 1))
```

No simultaneous access (invariant 1). No mutexes for ordinary Menard mutation.
**Logical races** remain if a critical section spans a suspension point:

```
let balance = deref(account)
let response = Http.get(url)     ; suspension — another task may mutate account
set!(account, balance + response.amount)
```

Document: operations between suspension points do not interleave with other
Menard tasks; operations spanning suspensions are not automatically atomic.
Developers coordinate shared state explicitly (e.g. an actor that serialises
updates, or avoiding suspend mid-update).

`StringBuffer` may likewise be shared; append ordering depends on scheduling.
Built-in mutators must not hide scheduling points that violate invariant 2.

#### Cost: parallelism later

Shared `Ref` under one mutator does **not** extend to multiple Menard mutator
threads. Shared-heap multicore would need locks, ownership, concurrent GC, or
isolated workers — **out of scope**; a separate architectural decision. CPU-bound
Menard stays one-core until then. Concurrent I/O still scales via many parked
tasks. Prefer processes / isolated workers over silently enabling shared-heap
parallelism (programs may rely on non-interleaving between suspension points).

#### Compiler work avoided

No `Sendable` derivation, capture analysis for sendability, or ownership transfer
in the typer for concurrency v1.

### 3.8 Request/reply ergonomics

Prefer what application authors write:

```
let user = Actor.call(user-manager, Get("123"))
```

Internally: temporary reply endpoint, send, park caller, resume on reply,
timeout / death handling. Avoid freezing an awkward public `call` that embeds
reply `Pid`s in every protocol message if a better protocol typing can evolve
(request type ↔ response type).

Request/reply alone is not enough long-term: notifications, streaming,
cancellation, and lifecycle events will appear — design `call` so it does not
block that evolution.

### 3.9 Example: UserManager (illustrative)

```
record User { id: Str, name: Str, email: Str }

type UserManagerMsg =
  | Put(user: User, reply: Pid UserManagerReply)
  | Get(id: Str, reply: Pid UserManagerReply)
  | Search(query: Str, reply: Pid UserManagerReply)

type UserManagerReply =
  | OkUser(User)
  | OkUsers(List User)
  | NotFound
  | BadRequest(Str)

let user-manager(initial: Map Str User) -> Unit {
  loop (db = initial)
    match (receive[UserManagerMsg]())
      | Put(user, reply) ->
        {
          send(reply, OkUser(user))
          recur(Map.set(user.id, user, db))
        }
      | Get(id, reply) ->
        {
          match (Map.lookup(id, db))
            | Some(u) -> send(reply, OkUser(u))
            | None -> send(reply, NotFound())
          recur(db)
        }
      | Search(query, reply) ->
        {
          let hits =
            Map.values(db) |> List.filter(fn (u) =
              String.contains(query, u.name) || String.contains(query, u.email)
            )
          send(reply, OkUsers(hits))
          recur(db)
        }
}
```

(Reply-`Pid`-in-message shape may be hidden behind `Actor.call` — see §3.8.)

### 3.10 Lifecycle, cancellation, mailboxes, and slow turns

#### 3.10.1 Cancellation and structured lifetimes (elevate to core)

Cancellation is **not** an open trivia item — it is required for servers and
request lifetimes (shutdown, client disconnect, drained accepts).

Prefer structured ownership in the Platform API (much of it can be Menard):

```
Task.scope(fn (scope) {
  Task.spawn(scope, fn () = work1())
  Task.spawn(scope, fn () = work2())
})
; on scope exit: children completed, or cancelled and joined
```

The **runtime** must provide cancellation-aware suspension. In particular,
define cancel behaviour for:

| Wait | On cancel |
|---|---|
| `Task.join` | waiter unblocks with a defined outcome |
| `Tcp.accept` / parkable I/O | wait ends; resource policy defined |
| `Mailbox.receive` | wait ends; message not spuriously lost without a rule |

Establish those semantics **before** implementing parkable I/O.

#### 3.10.1a Resource lifetime (implementation requirement)

Structured **task** lifetimes are not enough for Menard’s domain. OS resources
(files, sockets, DB connections, child processes) are not merely GC memory.

If a task is cancelled mid-`Http.read-request`, it may never reach `Tcp.close`.
GC of a Menard wrapper does not guarantee timely deterministic OS close.

**Requirement (before concurrent networking — Phase 8):** a cleanup story that
runs when a task exits normally, fails, or is cancelled — e.g. scoped helpers
(`Tcp.with-connection(conn, fn (c) = …)`) or an existing Menard construct if one
fits. Syntax TBD. **Structured task lifetimes and structured resource lifetimes
must work together.** This is an implementation requirement, not a sixth
concurrency invariant.

#### 3.10.2 Actor lifecycle and mailboxes

Actors need explicit semantics for:

| Event | Questions to answer |
|---|---|
| Normal return | Is the actor dead? Are queued messages dropped or rejected? |
| Panic | Observable failure? Who is notified? |
| Message after death | Error to sender? Dead-letter? |
| Reachability | GC when no `Pid` remains and mailbox empty? |
| Overload | Bounded mailbox? Backpressure? Unbounded until OOM? |

**Principles (draft):**

- Termination is **observable**.
- Failures must not **silently disappear**.
- Mailboxes should **eventually** support bounded capacity / backpressure.
- Supervision may be a **library**, but the runtime must expose enough lifecycle
  / cancel hooks to make supervision possible.

**Slow I/O inside an actor:** while a turn is suspended in `Database.query(...)`,
later messages wait (single activity). Document it. Long waits often belong in
**worker tasks** that message results back; prefer not to suspend mid-update of
shared cells (logical race across suspension — §3.7).

### 3.11 Determinism: semantic agreement ≠ execution equivalence

The dual implementation must agree on **specified observable behaviour**, not
identical schedulers or identical interleavings.

Specify and test in both hosts:

- message ordering guarantees (e.g. per-pair FIFO),
- single-mutator / non-interleaving between suspension points,
- delivery and termination,
- timeouts and cancellation,
- fairness (if any).

Native code may use an OS event loop; the interpreter may use host promises.
That is fine.

**Fixed point / `bc0 == bc1` stays about deterministic compiler output**, not
deterministic execution of arbitrary concurrent programs. Concurrent apps must
not feed nondeterminism into emission paths (§2.11.B spirit).

### 3.12 Implementation sequence (revised)

| Phase | Objective | Deliverable |
|---|---|---|
| 1 | Formalise `mn_*` | Stable Runtime ABI + Platform API wrappers |
| 2 | Expand standard library | Files, processes, time, JSON (and related) in Menard |
| 3 | FFI proving ground | e.g. SQLite; keep Runtime ABI ≠ C FFI ABI (§2.2). Follow-on link/package design: [design-ffi.md](design-ffi.md) |
| 4 | **Prove suspension/resumption** | §3.5.1 — native **and** TypeScript interpreter **and** GC; shared `Ref` |
| 5 | Internal task scheduler | Atomic-wait *guarantee*; cancel; **no public wake**; single mutator |
| 6 | Public `Task.*` | `spawn` / `join` / `scope` / `yield` (shared `Ref` OK) |
| 7 | Mailbox + Actor in `stdlib` | Menard queues; `Actor.*`; lifecycle by convention |
| 8 | Parkable TCP then HTTP | Cancel-aware I/O; **resource cleanup** (§3.10.1a); suspend catalogue |
| 9 | Supervision and backpressure | Bounded mailboxes; reliable long-running services |

Phases **1–3 proceed independently** of concurrency — **begin Platform API work
now.** Phases **4–9** are the concurrency initiative. Background OS workers must
**not** directly mutate the Menard heap; heap-touching work stays on the single
mutator (§3.0.1).

---

## 4. Runtime impact (dictated by library philosophy)

The library slogan decides the runtime budget: **Menard is the default; native
must justify its existence** (correctness of the dual-hosted meaning, or a
measured hot path). Pay twice only for what cannot live once in Menard.

### 4.1 What stays in the runtime (irreducible)

Already justified:

- One-word values, allocator, STW GC (layout kinds, static pool, shadow stack)
- Built-in shapes: lists, records/variants, closures, `Map`, `StringBuffer`, `Str`
- Derive clients: `show`, `=`, `compare`, `dump`, `print`/`println`
- Host seam today: files, env, argv, exit, argv-vector spawn — as `mn_*`

### 4.2 What the library philosophy forbids growing casually

- General mutable arrays / `MutBytes` as an open door
- A wide ambient OS global
- App-visible `mn_*` without Platform API wrappers
- Process-control sprawl (signals, shell strings, `fork` — already refused)
- Reimplementing the filesystem as an actor tree *inside* the runtime
- Native JSON/HTTP/crypto/… **without** a concrete justification (Menard first;
  native only for correctness-of-meaning or measured hot paths)

### 4.3 Concurrency machinery (provisional — after Phase 4)

| Piece | Where | Notes |
|---|---|---|
| Cooperative scheduler | **Runtime** | One Menard mutator; switch only at suspend/yield |
| create / atomic wait / resume / cancel | **Runtime (internal)** | No lost wakeup; cancel-aware |
| Suspension / continuations | **Runtime** | **Hard problem**; §3.5.1 (incl. shared `Ref`) |
| Parkable or completion I/O | **Runtime** | After wait+cancel semantics; document suspend points |
| Optional blocking pool | **Runtime** | Must not mutate Menard heap directly |
| Public `Task.*` | **`stdlib`** | spawn/join/scope/yield — **not** raw wake |
| Mailbox storage | **`stdlib`** | Shared `Ref` + queue; atomic wait from runtime |
| `Actor.*` | **`stdlib`** | Abstraction, not isolation boundary |
| `Sendable` / ownership | **Absent (v1)** | See §3.7 |
| Native ring-buffer mailbox | Optional later | Only if Menard queue is too slow |

### 4.4 GC: new root categories (prerequisite, not afterthought)

| Root category | Status |
|---|---|
| Active shadow stack | Existing |
| Global/static references | Existing |
| Actor / task mailboxes | **New** when concurrency lands |
| Suspended computations | **New** — every live local must remain visible |
| Scheduler queues | **New** |
| Pending I/O operations | **New** |

**Invariant:** every live Menard value remains visible to the collector,
including values owned by suspended computations. GC correctness is a
**prerequisite** for concurrent I/O, not a cleanup pass afterwards.

v1 bias remains cooperative scheduling + STW on a single mutator until the
cooperative story is boring.

### 4.5 Layering (target shape)

```
APPLICATIONS / MENARD LIBRARIES
        │  frameworks, SQLite bindings, app actors, Task.spawn, …
STANDARD LIBRARY  (Platform API)
        │  fs, json, http?, Task.*, Actor.*, Mailbox, time, …
MENARD NAMESPACE
        │  builtins; thin decls over Runtime ABI
C RUNTIME + INTERPRETER  (Runtime ABI)
        │  mn_*, GC, values; later: internal task scheduler, atomic wait,
        │  cancel, poll/pool  (≠ public C FFI ABI)
OPERATING SYSTEM
```

### 4.6 Dual-implementation tax

Every new `mn_*` and every concurrency semantic is implemented in C and in the
TypeScript host. Agree on the **specification**, not on identical internal
schedulers (§3.11). This is the strongest argument for keeping the irreducible
core tiny.

### 4.7 Impact summary

| Library principle | Runtime consequence |
|---|---|
| Small Runtime ABI | Grow `mn_*` slowly; evolve without breaking Platform API |
| Rich Platform API in Menard | JSON/HTTP/etc. do not enlarge C by default |
| No ambient `Menard.*` | `mn_*` unexported; `std/` wraps |
| Sync-looking I/O (when concurrent) | Internal suspend; no Future type; cancel-aware |
| Actors preferred publicly | **`stdlib` on tasks** — abstraction, not isolation |
| Mailboxes | Menard `Ref`+queue + **atomic wait** |
| Shared `Ref` / buffers | Allowed under single mutator; no `Sendable` |
| Hide scheduler knobs | Public Task API ≠ internal resume/wake |
| No shared-heap multicore (v1) | Explicit exclusion; separate decision later |
| Determinism / fixed point | Semantic agreement for concurrency; byte agreement for emission |

---

## 5. Settled architecture vs open implementation questions

### Do not reopen (architecture)

Purpose; Runtime ABI ≠ Platform API; rich Menard stdlib; tasks underneath;
mailboxes and actors in Menard; no `Sendable`; shared `Ref`/`StringBuffer`;
cooperative single mutator; no `async`/`await`; sync-looking I/O; cancellation
and scopes; no shared-heap multicore initially; suspension experiment before
public concurrency APIs.

### Implementation questions (answer with experiments / code)

1. Exact `std/` membership as packages grow (JSON/HTTP/TCP) — evolve in tree.
2. Menard libraries delivery (hashes / lockfile) — later.
3. Suspension representation that works in **both** LLVM and the TS interpreter
   (§3.5) — Phase 4.
4. Atomic-wait **mechanism** (not the guarantee) — Phase 5.
5. Public Task / Actor API spellings; suspend-point catalogue.
6. Cancel + **OS resource cleanup** pairing (§3.10.1a) — before Phase 8.
7. Mailbox queue shape; actor death / backpressure details.
8. When (if ever) shared-heap multicore — **separate** design document.
9. Spec migration: which §1.3 non-goals flip on library vs concurrency
   ratification; permanent refusals (`fork`, shell strings, …).

---

## 6. Final review assessment

| Dimension | Assessment |
|---|---|
| Architectural coherence | Strong |
| Consistency with Menard’s philosophy | Strong |
| Language complexity | Appropriately constrained |
| Runtime complexity | Moderate — suspension the main risk |
| Concurrency programming model | Simple and understandable |
| Type-system implications | Minimal (no `Sendable`) |
| GC implications | Significant but recognised |
| Platform API design | Sensible |
| Future extensibility | Good, except shared-heap multicore |
| Implementation readiness | **Ready to proceed incrementally** |

**Verdict:** architecture complete. Ratify purpose and libraries; approve
concurrency as the implementation direction; prove it with Phase 4; **start
building the Platform API.**

---

## 7. Related documents

| Document | Role |
|---|---|
| [buildout-libraries-concurrency.md](buildout-libraries-concurrency.md) | Planning: six builds, dependencies, open questions |
| [menard-spec.md](menard-spec.md) | Normative language (unchanged until ratification) |
| [decisions.md](decisions.md) | History and standing ADRs |
| [stdlib.md](stdlib.md) | Current standard library surface |
| [notes/stdlib-ecosystem-research.md](notes/stdlib-ecosystem-research.md) | Deno/Bun/Elm/Kestrel/Haskell comparisons |
| [runtime/README.md](../runtime/README.md) | Current C runtime layout |

---

## 8. One-page restatement

**Purpose** — Agreement-first language expanding into the Go/Deno/Bun domain
without abandoning the fixed point. **Ratify.**

**Libraries** — Small Runtime ABI (`mn_*`); rich Platform API in Menard.
Native must justify; Menard is the default. **Ratify. Build Phases 1–3 now.**

**Concurrency** — Architecture **approved**; formally provisional until Phase 4.
Cooperative single mutator (all heap access serialised); shared `Ref`; no
`Sendable`; Task/Mailbox/Actor in `stdlib`; atomic-wait *guarantee*;
cancellation + OS resource cleanup; sync-looking I/O. No shared-heap multicore
yet.

**Runtime** — Irreducible values/GC/`mn_*`; later internal scheduler + atomic
wait. Not a native actor subsystem. Suspension must work in native **and**
interpreter.

**Next step:** stop refining this architecture; implement the Platform API.
