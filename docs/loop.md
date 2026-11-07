# The backlog loop

`make loop` runs one pass of the backlog loop:

1. pick the next item that can be started,
2. branch for it,
3. plan it with Cursor,
4. implement it with Cursor,
5. gate it,
6. review it independently,
7. commit,
8. open a PR.

It exists because that loop, held in a person's head, is a list of steps that
can each be skipped for a good reason on a bad day — starting a feature on a
dirty tree, calling a green build "done" without re-reading the acceptance
criteria, or asking the agent that wrote the code whether the code is good.

The driver is deliberately boring. It makes no judgement about the work. It
owns the parts that must not be negotiable, and it delegates the parts that
need judgement to Cursor, with a written contract for each.

## The split

| Owner | Steps | Why |
| --- | --- | --- |
| The driver (`tools/loop/run.ts`) | select, branch, gate, commit, PR | Code, so it cannot be skipped, reordered, or softened by the agent it is grading. |
| Cursor | plan, implement, fix | Judgement. |
| Cursor, fresh context | review | The agent that wrote the code is the worst possible reviewer of it. |

The agent never runs `git commit`, `git push`, or `gh pr create`. Every prompt
says so; the driver is the only place those commands appear.

## Skills, not prompts

The method lives in two skills under `.agents/skills/`, in the same format as
the skills used when driving Cursor by hand:

- `menard-plan` — how to research an item, and the shape of the plan it must
  produce, including the AC evidence table;
- `menard-implement` — the implementation method with the harness overrides:
  no commit, no full suite, write the summary file.

The prompts in `tools/loop/prompts.ts` carry only the task data and the machine
contract: the item, the AC ids, the output paths, the JSON shape.

The driver also marks the item's `docs/backlog.md` row `done` before committing.
The definition of done requires that in the same PR, and an item merged while
still `ready` is selected again — which is exactly how LANG-18 came back a
second time. Changing how
the loop plans or implements means editing a skill, and the change applies to
manual sessions too.

## Acceptance criteria as ids

The review's `- [ ]` bullets become `AC1 … ACn` (saved as `acs.json` in the run
directory). The plan's evidence table must have one row per id, and the review
verdict must have one entry per id. Both are checked by the driver:

- a plan that misses an AC is retried once, then stops the run **before** the
  implementation — a bad plan costs five minutes, not twenty;
- a verdict that misses an AC is marked `satisfied: false` with the missing ids
  added to `gaps`, so they go to the fix round instead of being silently
  accepted.

## What "next" means

`make loop` uses the same report as `make next`: the lowest open phase, rows
whose every blocker is `done`, ordered by priority and then ID. It refuses to
start when `make next` has nothing to say, which keeps the loop honest about the
phase gate instead of quietly working ahead.

`make loop ARGS="--item CONC-05"` overrides the choice. That is for when a P0
lands in the middle of another item, not for skipping the queue.

The base defaults to `origin/main`, not local `main`: a stale local main silently
branches from old history and, worse, runs whatever driver that old tree had. The
driver refuses a base that is behind its upstream unless you pass
`--allow-stale-base`, and prints its own blob hash at startup so you can see which
harness is running.

Before the first branch is cut, the driver fetches `<base>` and fast-forwards
local `<base>` to it — once per session, so every item in a drain shares a base.
`--no-fetch` skips that for offline work (and then a stale base stays stale).

## Draining the backlog

`make loop ARGS=--drain` keeps going: after a PR is open it selects the next
ready item and repeats, stopping when nothing is ready or when a step fails.

Drain selects from the **base** backlog (`git show <base>:docs/backlog.md`),
not the working tree, and skips items it has already done this session. That
matters because a finished item is `done` only on its own branch: reading the
tree would either pick the same item again, or start work whose dependency is
not merged yet.

- Each item gets its own branch from the base and its own PR.
- A failure stops the drain, leaving that item's state and artifacts for
  `--resume`.
- `--max-items N` caps a drain.
- `--drain` does not mix with `--item` or `--resume`.
- It is cheapest on small, independent items. A dependency that only becomes
  `done` in this session stays blocked, by design.

### Stopping a drain

A drain has no natural end, so it checks `.loop/stop` between items. From
another terminal:

```bash
touch .loop/stop
```

The current feature runs to its PR, then the drain exits with
`Stop requested (.loop/stop) — stopped after N item(s)` and removes the file.
A stop request that arrives too late for one run is cleared rather than
leaking into the next.

`Ctrl-C` is the blunt instrument: it aborts the current step (the agent session
dies with it), leaving the state and artifacts for `--resume`. Use it when you
want to stop mid-feature, not between features. To bound a run up front,
`--max-items N` is better than either.

## The gate

The gate is exactly the sequence in the PR template, in order:

```
rm -rf ~/.menard && make && make ci && ./mn test
```

Each step is a separate command so a failure names itself, with one log per
step per attempt (`gate-1-make-ci.log`, `gate-2-make-ci.log`). `make
check-fixed-point` is added automatically when the diff touches `src/` or
`runtime/`; `--fixed-point` forces it and `--no-fixed-point` never runs it.

Two things keep it from being paid twice:

- **The cache is cleared once per run.** A cold build proves the tree from
  nothing, but a fix round does not need to recompile the compiler to test the
  fix; retries reuse `~/.menard`. `--cold` forces a cold gate.
- **A green gate is stamped against the tree.** `gate.stamp.json` records the
  tree hash and the gate's steps; if the tree has not changed since a green
  run, the gate is skipped and says so. A fix changes the tree, so a real
  second attempt still runs.

The implementer and fixer are told that the gate belongs to the driver and are
told not to run `make test`, `make ci`, `./mn test` or `make check-fixed-point`
themselves. When they do anyway, the driver notices on the event stream and
logs it as a warning under the step.

The gate is not the whole of "production quality" — a green suite that tests
the wrong thing is still green. That is what the review pass is for.

## The review pass

After the gate is green, a second Cursor session gets the item's specification
section, the changed files, the diffstat, and the diff itself (truncated at
24k characters), with one instruction: decide, criterion by criterion, whether
the work is real. It reads the code and the tests, not the implementation
summary. The session is read-only (`--mode ask`; shell commands are rejected), so
the prompt says so, and the verdict rests on inspection rather than a second test
run. It is told not to write a plan, because plan mode turns the verdict into a
plan document. The verdict is harvested from the final message or any plan
payload; if no JSON is found, the driver makes one cheap formatting call before
failing with the command that commits the green tree anyway
(`--resume --no-review`). It looks for the specific ways this kind of work is
usually faked:

- stubs, `TODO`, dead code, `@test true`, skipped tests, or a fallback that
  hides a failure;
- a native path fixed without the interpreter, or the reverse;
- tests that would pass against the old behaviour;
- documentation claims the code does not support;
- a backlog row marked `done` for something that is not done.

It returns JSON, not prose, so the driver can act on it:

```json
{
  "satisfied": false,
  "criteria": [{ "criterion": "…", "status": "partial", "evidence": "tests/actor/…" }],
  "gaps": ["…"],
  "notes": "…"
}
```

Each criterion entry is keyed by its AC id; the driver fails a verdict that
omits one. The verdict is not trusted blindly either: an unparseable verdict
stops the run rather than passing it. Fail closed, always.

## What happens when it is red

A failed gate or a review with gaps produces a repair prompt containing the
failing step, the tail of its log, and the review's `gaps` list. The agent
fixes; the driver re-runs the gate and the review from the top.

`--max-rounds N` (default 2) bounds this. When the budget is spent the driver
stops, leaves the branch and every artifact in place, and tells you to fix it
by hand and `--resume`. It does not keep spending tokens on a loop that is not
converging, and it does not commit a red tree.

## Resuming

State lives in `.loop/state.json`; the phase of the run is written before each
step that can fail. `make loop ARGS=--resume`:

- refuses unless you are on the branch the run recorded;
- skips a plan that already exists in `.loop/<item>/plan.md`;
- skips an implementation whose summary already exists;
- re-runs the gate and the review from scratch, because those are the parts
  that must never be assumed.

If a stopped branch was rebased, its push is rejected; the driver retries with
`--force-with-lease`, but only when the branch has no open PR, so it never
rewrites a branch somebody is reviewing.

If the run had already reached the commit or PR step, it resumes there instead
of repeating the gate. A resumed run whose tree matches the last green gate
skips the gate as well. A failure is stored as `lastError` in the state file and
reported when the run resumes. On success the state file is removed, so the next
`make loop` starts clean. The per-item artifacts stay.

## Watching a run

Everything the loop does is streamed to stdout and appended to
`.loop/<item>/run.log`:

- each gate command's output as it runs, not after it finishes;
- `cursor-agent`'s event stream — the model, the assistant's text, tool calls
  as `→ shell: make typecheck`, `→ read: stdlib/actor.mnd`, `→ edit: …`, and the
  final `result`;
- a heartbeat every 20 seconds when nothing has arrived, so a long tool call
  never looks like a hang;
- structural lines stamped `[09:41:12 +00:14:03]`, the driver's hash, and a
  closing summary with the time each stage took;
- a `FAILED:` line as the last thing printed, also written to `run.log`.

The driver runs the agent with `--output-format stream-json` for this reason.
The raw NDJSON is kept in `cursor-<stage>.log` beside the rendered text.

## Artifacts

```
.loop/
  state.json            run state; removed on success
  <item>/
    run.log               every command and decision, in order, stamped
    plan.md               the plan the implementation followed (captured from
                          the plan artifact, not the chat narration)
    acs.json              the acceptance criteria as AC1 … ACn
    summary.md            the implementer's account of what changed
    agent-summary.md      where the implementer writes that account
    fix-<n>.md            repair notes, one per round
    cursor-<stage>.log    raw NDJSON, one per agent session
    gate-<n>-<step>.log   one log per gate step per attempt
    gate.stamp.json       tree hash + steps of the last green gate
    cache-cleared         when ~/.menard was last cleared
    review-<n>.raw.md     the reviewer's raw output, per attempt
    review-<n>.json       its parsed verdict, per attempt
    review.json           the latest verdict
    pr.md                 the PR body that was submitted
  <item>-dry/           the same, for --dry-run
```

`.loop/` is gitignored. Plans are working documents, not commits: the PR is
the record of what changed, and the review is the record of whether it was
good enough.

## Commands

```
make loop                          # one pass, all the way to the PR
make loop ARGS="--dry-run"         # resolve the item and print the loop; no side effects
make loop ARGS="--item CONC-05"    # start a named item
make loop ARGS="--resume"          # continue after a stop
make loop ARGS="--no-review"       # gate only; the review pass is the point, so justify this
make loop ARGS="--fixed-point"     # force make check-fixed-point into the gate
make loop ARGS="--no-fixed-point"  # never run it (it is automatic for src/ and runtime/)
make loop ARGS="--cold"            # clear ~/.menard again instead of reusing it
make loop ARGS="--allow-stale-base" # branch from a base that is behind origin
make loop ARGS="--no-fetch"        # do not fetch / fast-forward the base first
make loop ARGS="--drain"           # keep going until nothing is ready to start
make loop ARGS="--drain --max-items 3"
make loop ARGS="--model gpt-5"     # choose the Cursor model
```

The driver refuses to start when the tree is dirty, when a run is already
recorded, or when the branch it would create already exists. Those are the
three ways a loop run corrupts itself.

## Changing the loop

- **Gate steps** are `gateSteps()` in `tools/loop/run.ts`. Add a step there and
  it is run, logged, and reported like the rest; nothing else needs to change.
- **The method** is in `.agents/skills/menard-plan` and
  `.agents/skills/menard-implement`. If plans are thin, fix `menard-plan`;
  if implementations cut corners, fix `menard-implement`. The prompts should
  stay thin, carrying only task data and the machine contract.
- **Prompt contracts** are `tools/loop/prompts.ts`, one function per phase. If
  the review is finding the same class of gap repeatedly, tighten the review
  prompt rather than the implement prompt — the reviewer is the one that has
  to catch it next time.
- **Commit and PR shape** are `commitSubject`, `commitBody`, and
  `pullRequestBody`. The PR checkboxes are only ticked after the driver has
  actually run them; do not move the tick into the prompt.

## Limits

- The review pass is a model reading a diff. It is better than asking the
  author, and worse than a person who knows the subsystem. Treat
  `satisfied: true` as "no objection found", not as a guarantee.
- One run, one item, one branch, one worktree. Two concurrent runs would fight
  over `.loop/state.json` and the checkout; this is deliberate.
- It does not merge, close issues, or tick boxes outside `docs/backlog.md`.
  Merging stays a human step.
