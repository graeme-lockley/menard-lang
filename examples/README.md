# Examples

Short programs that exercise Phase 3 emitter features. Each one prints a
short description of its result and exits 0. Run with
`./mn run examples/<file>.mnd` (native) or `./mn inter examples/<file>.mnd`
(interpreter). `sc.mnd` is an implementation of the [String Calculator Kata](https://osherove.com/tdd-kata-1); run its tests with
`./mn test examples/sc.mnd`.

| File | Slice | Shows |
| --- | --- | --- |
| `sc.mnd` | kata | String Calculator, built as a test-driven module |
| `loop-sum.mnd` | A | `loop` / `recur` |
| `bool-unit.mnd` | B | Bool/Unit immediates, Bool-returning helpers |
| `list-sum.mnd` | C | `List` + `match` on `Cons`/`Nil` |
| `result-match.mnd` | C | `Result` + `match` on `Ok`/`Err` |
| `strings.mnd` | D | `String.concat`, Str values, `write` |
| `stringbuffer.mnd` | D | `StringBuffer` (`Buf.new` / `Buf.append!` / `Buf.take-str!`) |
| `ref-counter.mnd` | D | `Ref` / `deref` / `set!` with `loop` |
| `closure-adder.mnd` | E | returned heap closure mapped over a `List` |
| `str-order.mnd` | H | value-directed `=` and `compare` on `Str` |
| `match-capture.mnd` | E | nested `fn` captures both `match` binders |
| `closure-result-bind.mnd` | E | Result + inline `fn` continuation |
| `map-env.mnd` | F | persistent `Map` (`Map.empty` / `Map.set` / `Map.lookup` / `Map.size`) |
| `echo-file.mnd` | G | `read-file` / `write` / `exit` (fixture under `fixtures/`) |
| `mod-main.mnd` + `mod-util.mnd` | G | multi-module emit (`import` flattened into one `.bc`) |
| `host-seam.mnd` | driver | `exists`, `getenv`, `spawn`, `rename` (native; run from the repo root) |
| `heap-churn.mnd` | collector | long `List`, large `Map`, `StringBuffer` growth, nested closures |

## Fixed point

`make check-fixed-point` is green: `bc0 == bc1`, `stage1 == stage2`, and
the installed `./mn` and stage1 link the same artifact. `emit` of
`src/mn.mnd` writes bitcode and spawns nothing. `hello.mnd` at the repo
root remains the smoke test.
