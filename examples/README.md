# Examples

Short programs. Each one that defines `main` prints a result and exits 0. Run one with `./mn run examples/<file>.mnd`, or on the interpreter with `./mn inter examples/<file>.mnd`.

`sc.mnd` is a [String Calculator](https://osherove.com/tdd-kata-1). It has no `main`. Its tests are `@test` lines:

```bash
./mn test examples/sc.mnd
```

| File | Shows |
| --- | --- |
| `sc.mnd` | A module with `Result`, lists, strings, and `@test` lines |
| `loop-sum.mnd` | `loop` / `recur` |
| `bool-unit.mnd` | `Bool` and `Unit` |
| `list-sum.mnd` | `List` and `match` on `Cons` / `Nil` |
| `result-match.mnd` | `Result` and `match` on `Ok` / `Err` |
| `strings.mnd` | `String.concat`, `Str`, `write` |
| `stringbuffer.mnd` | `StringBuffer`: `new`, `append!`, `take-str!` |
| `ref-counter.mnd` | `Ref`, `deref`, `set!` |
| `closure-adder.mnd` | A closure returned and mapped over a list |
| `match-capture.mnd` | A nested function capturing `match` binders |
| `closure-result-bind.mnd` | `Result` with an inline continuation |
| `map-env.mnd` | A persistent `Map` |
| `str-order.mnd` | `=` and `compare` on `Str` |
| `float-ops.mnd` | `Float` arithmetic, including `-0.0` |
| `derive-show.mnd` | Derived `show` for a record and a variant |
| `echo-file.mnd` | `read-file`, `write`, `exit` |
| `mod-main.mnd`, `mod-util.mnd` | Two modules compiled into one binary |
| `host-seam.mnd` | `exists`, `getenv`, `spawn`, `rename`. Run it from the repo root |
| `heap-churn.mnd` | A long list, a large map, a growing buffer, and nested closures |

`make check-fixed-point` builds `examples/loop-sum.mnd` twice, once with the installed `./mn` and once with stage1, and compares the binaries.
