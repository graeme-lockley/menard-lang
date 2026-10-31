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

## What "next" means

`make loop` uses the same report as `make next`: the lowest open phase, rows
whose every blocker is `done`, ordered by priority and then ID. It refuses to
start when `make next` has nothing to say, which keeps the loop honest about the
phase gate instead of quietly working ahead.

`make loop ARGS="--item CONC-05"` overrides the choice. That is for when a P0
lands in the middle of another item, not for skipping the queue.

## The gate

The gate is exactly the sequence in the PR template, in order, each step run
from a clean cache:

```
rm -rf ~/.menard && make && make ci && ./mn test
```

Each step is a separate command so a failure names itself, and every log is
kept under `.loop/<item>/gate-*.log`. `--fixed-point` adds
`make check-fixed-point` for changes that touch the compiler or the runtime
ABI; it is off by default because it is slow, not because it is optional when
the item calls for it.

The gate is not the whole of "production quality" — a green suite that tests
the wrong thing is still green. That is what the review pass is for.

## The review pass

After the gate is green, a second Cursor session gets the item's specification
section, the list of changed paths, and one instruction: decide, criterion by
criterion, whether the work is real. It reads the code and the tests, not the
implementation summary. It looks for the specific ways this kind of work is
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

The verdict is not trusted blindly either: an unparseable verdict stops the
run rather than passing it. Fail closed, always.

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

If the run had already reached the commit or PR step, it resumes there instead
of repeating the gate. On success the state file is removed, so the next
`make loop` starts clean. The per-item artifacts stay.

## Watching a run

Everything the loop does is streamed to stdout and appended to
`.loop/<item>/run.log`:

- each gate command's output as it runs, not after it finishes;
- `cursor-agent`'s event stream — the model, the assistant's text, tool calls
  as `→ shellToolCall: make ci`, and the final `result`;
- a heartbeat every 20 seconds when nothing has arrived, so a long tool call
  never looks like a hang.

The driver runs the agent with `--output-format stream-json` for this reason.
The raw NDJSON is kept in `cursor-plan.log` and `cursor-write.log` beside the
rendered text.

## Artifacts

```
.loop/
  state.json            run state; removed on success
  <item>/
    run.log             every command and decision, in order
    plan.md             the plan the implementation followed
    summary.md          the implementer's account of what changed
    fix-1.md            repair notes, one per round
    gate-make.log       one log per gate step
    review.raw.md       the reviewer's raw output
    review.json         its parsed verdict
    pr.md               the PR body that was submitted
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
make loop ARGS="--fixed-point"     # add make check-fixed-point to the gate
make loop ARGS="--model gpt-5"     # choose the Cursor model
```

The driver refuses to start when the tree is dirty, when a run is already
recorded, or when the branch it would create already exists. Those are the
three ways a loop run corrupts itself.

## Changing the loop

- **Gate steps** are `gateSteps()` in `tools/loop/run.ts`. Add a step there and
  it is run, logged, and reported like the rest; nothing else needs to change.
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
