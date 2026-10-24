# Build D — Task runtime + public `Task.*`

**Status:** done (native + interpreter acceptance green).  
**Blocks:** Build E (mailbox / actor).  
**Architecture:** [design-libraries-concurrency.md](../libraries-concurrency.md) §3.3.2 / §3.10.1.  
**Prior gate:** [build-c-suspension.md](c-suspension.md).

## Decisions

| # | Decision |
|---|---|
| 1 | Platform module: `std/task` (`import std/task as Task`). |
| 2 | Internal seam remains `std/sched` (harness + wait cells). Apps must not import it. |
| 3 | `Task.join` → `Result a Cancelled` (`Cancelled` unit ADT). |
| 4 | `Task.cancel` is public; scope exit also cancels unfinished children. |
| 5 | Scope: `Task.scope(body)` + `Task.spawn-in(scope, thunk)` + bare `Task.spawn`. |
| 6 | Atomic wait: runtime **wait cells** (`mn_task_wait_new` / `wait` / `notify`) with sticky notify. Build E: multi-waiter FIFO; `wait` → `Result` (cancel soft-resume). Not Platform API. |
| 7 | Handles: `type Task[a] = Tid(Int)` (ctor name `Tid` so the module alias `Task` is free). Debug via `Task.id`. |
| 8 | Fairness: cooperative `Task.yield` only; no priorities. |
| 9 | Join from any task (Build C main-only restriction lifted). |

## Layering

| Layer | Role |
|---|---|
| `stdlib/task.mnd` | Platform API — no `extern`; wraps `std/sched` |
| `stdlib/sched.mnd` | Internal seam — `mn_task_*` including wait cells and `suspend-for-test` / `resume` |
| `runtime/src/task.c` + `host/src/interp/task.ts` | Dual-host scheduler, fibers / Cont, wait cells, cancel |

**No public park/wake.** `Sched.resume` and `Sched.suspend-for-test` stay harness-only.

## Wait-cell guarantee

`mn_task_wait(cell)` and `mn_task_notify(cell)` are atomic at the runtime boundary: no Menard runs between the notified-bit check and park. Notify-before-wait is sticky; the waiter returns without sleeping. Build E extends cells to a **multi-waiter FIFO** (notify wakes ≤1) and makes `wait` return `Result Unit Unit` so cancel soft-resumes with `Err` (see [build-e-actors.md](e-actors.md)).

## Cancel matrix (D)

| Situation | Outcome |
|---|---|
| `Task.join` on a cancelled task | `Err(Cancelled)` |
| `Task.cancel` on runnable / suspended | Mark cancelled; wake joiners / wait-cell waiters |
| `Task.cancel` while target is running | Cooperative: takes effect at next park / yield / wait |
| `Task.scope` exit | Cancel each child id, then join each |

## Suspend catalogue (v1)

May suspend: `Task.join`, `Task.yield`, `Task.scope` (exit path via join), and internal wait-cell wait (for E).  
Must not suspend: pure stdlib ops, non-listed seam calls.

## What Build E can rely on

- Public `Task.spawn` / `join` / `cancel` / `yield` / `scope` / `spawn-in`
- Wait cells for mailbox receive (via `std/sched` or a thin future wrapper)
- Shared `Ref` across tasks under the single mutator
- Cancel unblocks join (and will unblock receive once E wires it)

## Known limitations

- `Task.spawn-in` is correct on the interpreter and on native without GC stress; under `MENARD_GC_STRESS` a cross-module rooting flake remains — acceptance tests use an equivalent local helper. Prefer fixing emitter rooting before E leans hard on `spawn-in` in stress suites.
- No priorities / preemption.
- Wait cells were single-waiter in D; multi-waiter + cancel-returning wait landed in E.
