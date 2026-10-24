# Build C — Suspension hard gate

**Status:** done (acceptance green on native + interpreter).  
**Unblocked:** Build D — see [build-d-tasks.md](d-tasks.md).  
**Architecture:** [design-libraries-concurrency.md](../libraries-concurrency.md) §3.5 / §3.5.1.

This is a **production hard gate**, not a throwaway prototype. “Experiment” in older
design wording means “prove suspend/resume before public Task APIs.”

## Mechanism

| Host | Control state | Menard heap roots |
|---|---|---|
| Native | Task-local fiber stacks (`ucontext` swap) | Per-task shadow stacks (`runtime/src/shadow.c`) |
| Interpreter | Explicit `Cont[]` trampoline (`host/src/interp/eval.ts`) | JS heap; park saves Cont stack on the task |

Observables must agree ([design §3.11](../libraries-concurrency.md)); internals need not.
Menard locals that survive a park live in GC-visible slots (native: shadow stack /
`mn_root_keep`), not in dead LLVM temporaries.

**Why fibers on native (not full state-machine lowering yet):** nested Menard calls
must park without rewriting every call site in the emitter. Dedicated stacks +
per-task roots meet §3.5.1 and keep a D-shaped scheduler ABI. A later deepening
may lower native Menard to explicit resume labels; the `mn_task_*` surface and
per-task roots remain.

## Scheduler skeleton (D-shaped)

Internal Runtime ABI (C + TS twin):

| Symbol | Role |
|---|---|
| `mn_task_spawn` | Enqueue thunk (`Fn () -> a` as closure) |
| `mn_task_self` | Current task id |
| `mn_task_suspend_for_test` | Synthetic park (Build C; not parkable I/O) |
| `mn_task_resume` | Enqueue a suspended task (internal — not public wake) |
| `mn_task_join` | Wait until Done (main only in C) |
| `mn_task_cancel` | Stub cancel |

Pump model: `join` / `resume` (from main) drain a runnable queue; each fiber runs
until park or completion. Single mutator: only one fiber executes Menard at a time.

Seam module: [`stdlib/sched.mnd`](../stdlib/sched.mnd) — **internal**, not Platform
API. Build D adds `std/task` and must not promote raw resume as public wake.

## Temporary APIs (must not ship as Platform API yet)

Do **not** document these in [stdlib.md](../../stdlib.md) as app-facing:

- Entire `std/sched` module
- `mn_task_*` symbols (except via a future `std/task` façade in D)
- `mn_task_suspend_for_test` / `Sched.suspend-for-test` (test/harness park)
- `mn_task_resume` / `Sched.resume` (internal wake — D hides this)

## Acceptance

Suite: [`tests/suspend/`](../tests/suspend/)

- Nested suspend inside `deep` while peer mutates a shared `Ref`
- `join` while the target runs / parks / completes
- Native under `MENARD_GC_STRESS` + `MENARD_HEAP_VERIFY`
- Interpreter same observables (`141` / `2` / `41`)

## What Build D can rely on

- Per-task GC roots and `mn_task_visit_roots`
- Cooperative runnable queue + spawn / join / cancel stubs
- Dual-host park/resume with shared `Ref`
- Seam confinement pattern for task symbols

D still owns: public `Task.spawn` / `join` / `scope` / `yield`, atomic-wait
**guarantee** for mailboxes, cancel outcomes, suspend catalogue — without
exposing resume/wake.
