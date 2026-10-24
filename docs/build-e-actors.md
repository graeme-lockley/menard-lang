# Build E — Mailbox + Actor

**Status:** done (native + interpreter acceptance green).  
**Blocks:** Build F (network / supervision).  
**Architecture:** [design-libraries-concurrency.md](design-libraries-concurrency.md) §3.3.3 / §3.6–3.8 / §3.10.2.  
**Prior:** [build-d-tasks.md](build-d-tasks.md).

## Decisions

| # | Decision |
|---|---|
| 1 | One Platform module: `std/actor` (Mailbox + Actor; no separate `std/mailbox`). |
| 2 | Two-list unbounded queue in Menard; wait cell for empty receive. |
| 3 | `Pid[a]` phantom message type (record: mailbox, task id, scope ref). |
| 4 | Typed `Actor.call` via `Ask[req, res]`; user protocols omit reply Pids. |
| 5 | Post-death send/cast/call → `Err(ActorDead)`. |
| 6 | Cancel during receive → `Err(ActorCancelled)`; message not dequeued. On actor cancel/failure, escalate by cancelling nursery task ids. |
| 7 | Simple name registry: `register` / `whereis` via type-erased process dict (`mn_task_dict_*`); honor-system typing. |
| 8 | Multi-waiter mailboxes; `notify` wakes ≤1 (FIFO). Close pokes up to 64 waiters. |
| 9 | `mn_task_wait` → `Result Unit Unit` (Err = cancelled soft-resume). |

## Layering

| Layer | Role |
|---|---|
| `stdlib/actor.mnd` | Platform API — Mailbox, Pid, serve*/call, registry |
| `stdlib/sched.mnd` | Wait cells + process dict (internal) |
| `stdlib/task.mnd` | Spawn / scope / yield used by actors |
| `runtime/src/task.c` + `host/src/interp/task.ts` | Multi-waiter cells, soft-cancel wait, dict |

Actors are **not** an isolation boundary; shared `Ref` across tasks remains allowed.

## Lifecycle (v1)

| Event | Behaviour |
|---|---|
| Normal body return | Mailbox closed; later sends → `ActorDead` |
| `Actor.cancel` / receive cancel | Soft `ActorCancelled`; close; escalate nursery ids |
| Message after death | `Err(ActorDead)` to sender |
| Process-fatal panic | Still process-fatal (document); prefer cooperative exit + escalate |

## Suspend catalogue (additions)

May suspend: `Mailbox.receive`, `Actor.call` (via receive on reply mailbox).

## API sketch

```
Mailbox.new / send / receive / close
Pid / spawn / spawn-in / cast / cancel / join / id
Ask[req, res] / call / serve / serve-state / serve-*-in
register / whereis
```

## Known limitations

- Unbounded mailboxes (bounds → Build F).
- Registry typing is honor-system (erased dict).
- `Actor.spawn-in` registers nursery ids locally (avoids cross-module `Task.spawn-in` rooting flake).
- Join must not auto-resume wait-cell waiters (native fix in Build E).
