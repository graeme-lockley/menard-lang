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
| `match-capture.mnd` | E | nested `fn` captures both `match` binders |
| `closure-result-bind.mnd` | E | Result + inline `fn` continuation |
| `map-env.mnd` | F | persistent `Map` (`map-new` / `map-set` / `map-get` / `map-size`) |
| `echo-file.mnd` | G | `read-file` / `write` / `exit` (fixture under `fixtures/`) |
| `mod-main.mnd` + `mod-util.mnd` | G | multi-module emit (`import` flattened into one `.bc`) |

## Slice H / fixed point status

- **`check src/main.mnd`** typechecks after private-symbol uniquify on flatten
  (`src/modules/graph.mnd`).
- **`emit src/main.mnd`** gets past match-binder capture. The next lower
  error is a call to `compare` (no runtime op yet). Top-level functions
  and constructors-as-values use `mn_closure_bare` / `mn_ctor_closure`.
  `examples/match-capture.mnd` prints `head 10, rest is non-empty, total 11`:
  a nested `fn` captures both match binders.
- **`make check-fixed-point`** is scaffolded; `bc0 == bc1` is **not** closed yet.
- `hello.mnd` at the repo root remains the smoke test.
