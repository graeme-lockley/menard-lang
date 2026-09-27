# Examples

Short programs that exercise Phase 3 emitter features. Each one prints a
short description of its result and exits 0. Run with
`./mn run examples/<file>.mnd` (native) or `./mn inter examples/<file>.mnd`
(interpreter).

| File | Slice | Shows |
| --- | --- | --- |
| `loop-sum.mnd` | A | `loop` / `recur` |
| `bool-unit.mnd` | B | Bool/Unit immediates, Bool-returning helpers |
| `list-sum.mnd` | C | `List` + `match` on `Cons`/`Nil` |
| `result-match.mnd` | C | `Result` + `match` on `Ok`/`Err` |
| `strings.mnd` | D | `str-concat`, Str values, `write` |
| `stringbuffer.mnd` | D | `StringBuffer` (`sb-new` / `sb-append!` / `sb-take-str!`) |
| `ref-counter.mnd` | D | `Ref` / `deref` / `set!` with `loop` |
| `closure-adder.mnd` | E | returned heap closure mapped over a `List` |
| `str-order.mnd` | H | value-directed `=` and `compare` on `Str` |
| `match-capture.mnd` | E | nested `fn` captures both `match` binders |
| `closure-result-bind.mnd` | E | Result + inline `fn` continuation |
| `map-env.mnd` | F | persistent `Map` (`map-new` / `map-set` / `map-get` / `map-size`) |
| `echo-file.mnd` | G | `read-file` / `write` / `exit` (fixture under `fixtures/`) |
| `mod-main.mnd` + `mod-util.mnd` | G | multi-module emit (`import` flattened into one `.bc`) |
| `host-seam.mnd` | driver | `exists`, `getenv`, `spawn`, `rename` (native; run from the repo root) |

## Fixed point

`make check-fixed-point` is green: `bc0 == bc1`, `stage1 == stage2`, and
the Menard driver's linked artifact matches the harness. `emit` of
`src/main.mnd` writes bitcode and spawns nothing. `hello.mnd` at the repo
root remains the smoke test.
