# Menard — Decision record

Dated ratifications and reversals, newest first, plus the index of the standing
decisions.

`menard-spec.md` is the specification. It states the design and nothing else —
no rationale-by-narration, no revision history, no argument with itself. This
file carries what the specification does not: *when* a decision was taken, *what
was rejected on the way*, *what is still unresolved*, and the standing rationale
table. `menard-spec-draft.md` is a frozen working draft from earlier in the
project, kept for reference only.

When this file and the specification disagree, the specification wins and this
file is wrong.

**On ADR numbers.** The standing decisions are numbered 1–39 in the index below,
and the dated entries refer to them by those numbers. The specification does not
cite them; it states rules and gives reasons inline, so it stands alone.

**On names and section numbers.** The dated entries are kept as written at the
time, so an older entry may use a name a later revision changed — `print!` before
v0.5.6, for instance — or cite a section number as it stood then. That is
deliberate: this is a record of what was decided, not a second copy of the
specification. Where a name changed, the entry that changed it says so.

---

## Decision index

The standing decisions, with their reasons and their costs. These are the load
bearing choices; everything in the specification follows from them.

| # | Decision | Reason | Cost if wrong |
|---|---|---|---|
| 1 | S-expressions, no sugar | Cheapest reader; no ambiguity | Ugly for outsiders; sugar costs double |
| 2 | Statically typed | Types drive the showable/orderable/equatable checks and exhaustive matching | Larger typer |
| 3 | `Int` = 63-bit tagged, **one integer type** | The tag bit makes uniform one-word values possible, and is load-bearing for the collector too (§2.2, §4.3); narrow buys no speed, wide costs boxing; a second type doubles the ways stage0 and the backend can disagree | Range limit; boxed `BigInt` eventually |
| 4 | `Float` boxed in a **`bytes` payload**, **no unboxed fields** | The payload is arbitrary bits, so it must never be scanned as slots; NaN-boxing would *narrow* `Int`; unboxing would break the collector's invariants (§4.3) | Allocation churn on float-heavy code |
| 5 | **Immutability, with exactly two reference types: `Ref` and `StringBuffer`** | Makes closure capture a copy; enumerating the exceptions keeps the rule checkable and keeps mutable state out of output | Two legal mutation paths to keep out of emission paths |
| 6 | No exceptions | Deletes `invoke`, landing pads, unwind tables | `Result` plumbing everywhere |
| 7 | **No macros, ever** | Macros tax every reader of every program; a closed syntax pays per idiom instead | ~dozen special forms implemented twice; prelude duplication; generic diagnostics |
| 8 | **No language-level iteration order; order derived from the type** | Maps have no semantic order; determinism belongs to traversal, and deriving it from the type keeps `Map` free to be any implementation | Any non-derived emission breaks the fixed point |
| 9 | Shape-pointer headers with a **layout kind** and a **location** bit, no GC field maps | One source of truth for layout and variant tags; layout handles the even-non-pointer cases (code pointers, f64 payloads); location handles static objects; and one descriptor per constructor puts the tag in the descriptor rather than in the object | Fixed per-object overhead; collector must consult both axes |
| 10 | `alloca` + `mem2reg`, not statepoints | Removes dominance/phi reasoning entirely | Requires side-effecting root stores |
| 11 | Runtime in C, not self-hosted | Runtime is not the interesting problem | Two languages in the repo |
| 12 | Single-threaded, STW collector | Removes barriers, safepoints, atomics | No concurrency in v1 |
| 13 | **stage0 in TypeScript on Bun** | Types help; `bigint` gives exact integers; shares reader with the oracle | Two implementations of the semantics to keep aligned |
| 14 | No import cycles | Simpler module compilation order | Mild annoyance |
| 15 | stage0 and the oracle share one codebase | Syntax has one host implementation | Coupling between build tool and test oracle |
| 16 | **No caller-supplied ordering predicate in output paths** | It would be viral, silently omittable, and could let stages disagree | Less flexibility in presentation |
| 17 | **Determinism is four obligations** (order, identity, text, arithmetic), plus two weaker ones for I/O boundaries and seeds | Each fails silently and independently | Emission paths deterministic in order but leaking addresses or float spellings |
| 18 | **Showable, orderable and equatable are separate positive predicates** | The three restrictions differ; exclusions alone are undecidable by a reader | A `Ref` nested in an emitted record prints an address and breaks the gate |
| 19 | **`Int` arithmetic: only `+`/`−` are free on tagged words** | A naive tagged multiply is wrong but *deterministic*, so the gate cannot catch it | Silent wrong arithmetic that passes `stage2 == stage3` forever |
| 20 | **The gate proves agreement, not correctness** | A deterministic bug shared by both implementations passes it every time | Over-trusting the bootstrap; skipping the oracle |
| 21 | **Type parameters are explicit and declared — never inferred** | Gives the abstraction without unification, generalization, HM diagnostics, or the value-restriction problem that `Ref` would force | More annotation at declaration sites; no `let`-polymorphism |
| 22 | **No Unicode normalisation, anywhere** | Equality and order must be over one representation or map key behaviour depends on spelling | Slightly surprising string equality for some users |
| 23 | **User nominal types take type parameters** | Shares all machinery with explicit function parameters; typer-only cost | No longer a "no generics" language, only a "no inference" one |
| 24 | **Tag-based precise collection, with layout kinds; no static GC field maps** | With type parameters no static map can exist; alternatives (monomorphization, dictionary passing) cost far more | Invariants become load-bearing; marking marginally slower; unboxing, `Byte` and general mutable arrays forbidden forever |
| 25 | **Two type views: canonical and display** | Aliases must never reach emitted bytes, but flattening them wrecks diagnostics | Two representations of types to keep straight |
| 26 | **Casing enforced: upper = type/constructor, lower = value** | Cheap, catches `Int`/`int`, makes signatures readable | A naming rule users cannot opt out of |
| 27 | **Private by default; `pub` to export**; `extern` never exported and confined to the seam modules | Keeps the module boundary real; you can tell what is safe to change; and the `extern` confinement gives the ambient boundary a marker the compiler can check | ~50 lines of visibility checking, plus the confinement lint |
| 28 | **The surface is four tiers, with a placement rule** | Compiler-known iff it needs per-type synthesis; runtime-backed iff it needs mutation or an opaque representation **and the compiler is a client on a hot path**; else prelude | Adding an operation means knowing which tier it belongs to |
| 29 | **Aliases are nullary and transparent** | Parameters would make them type-level functions, i.e. the higher-kinded feature that is out | Cannot abstract over container shape with an alias |
| 30 | **`!` marks observable mutation only; the OS boundary is marked by `extern`, not by a name** | One glyph for two ideas meant neither was reliable, and `!`-for-purity was a gesture at effects the language refuses (no propagation, no effect system) | The convention covers one special form and four functions and is still unchecked; the ambient audit moves from a naming habit to a lintable module boundary |
| 31 | **`Map` requires orderable keys and is persistent** | Deterministic iteration by construction; value semantics preserved; deletes hash from the agreement surface | HAMT in the runtime (~300 lines ×2); no `Ref`/`Fn` keys |
| 32 | **No `Byte` type; `Char` is a scalar value; `Str` is arbitrary bytes** | A `Byte` is a second integer type with the same agreement cost as `Int32`; bytes are small `Int`s with a documented range | Byte/character confusion is a documented-range question, not a type error |
| 33 | **`StringBuffer` is a built-in reference type** (§2.8.2) | It needs in-place mutation, and the compiler is its hot-path client; `sb-take-str!` is free because `Str` and the buffer share one payload shape | ~200 lines of C and ~200 of TS, implemented twice; a second mutation path to keep out of output |
| 34 | **Copy-on-write after a non-destructive `sb-to-str`** | A shared backing store means an append could otherwise mutate an immutable `Str` already held by a caller | One extra copy on the first append after a conversion; a rule both stages must implement |
| 35 | **Debug output is a separate printer — `dump` — writing only to fd 2, with no way to become a value** | Debugging needs to see `Ref`, `Fn` and `StringBuffer` contents, which `show` must refuse; isolation by *type*, not by convention, means a forgotten `dump` cannot break the fixed point | A sixth compiler-known intrinsic once `println` is counted; the loose policy in the derive engine; two kinds of text on stderr with opposite determinism rules |
| 36 | **Menard has no `null`; the empty word is an allocator sentinel, not a value — kept, and paired with an *asserted* no-partial-publication discipline** | Filling an object's fields may allocate, so the collector can run mid-construction; without a distinguished word an unwritten slot holds a stale pointer or an even non-pointer, traced silently in both stages. The word converts that into a wasted read; the discipline — and its heap-verify assertion — is what stops the collector *depending* on it | One extra test in the marking loop; one `memset` per recycled object; one non-value word in the representation that must be kept out of the language, out of output, and out of the debug printer |
| 37 | **Process spawning is admitted, in argv-vector form only; shell strings and `fork` are refused permanently** | The build driver must be Menard, or the language's own integration test lives in a shell script; argv is data the compiler can see and check, whereas a shell string is unbounded ambient state in one string; and `fork` copies a GC's heap and collector state | ~310 lines implemented twice; a `SpawnError` taxonomy to keep aligned; a non-hermetic test tier; one more way for a path to reach the artifact |
| 38 | **Literals and nullary constructors are static objects; layout and location are separate axes** | A literal or a nullary constructor is a constant of the program, so allocating it at each evaluation is pure waste — and for `Str`, which is not interned, "each evaluation" means each loop iteration. Making the pool static deletes the allocation rather than optimising it; splitting location from layout is what lets a `bytes` object be static and lets a nullary variant be header-only | ~120 lines across two stages for the pool; two new determinism obligations (dedup and emission order); a layout/location pair to keep straight; and the invariance rules of §2.2.1 must hold |
| 39 | **`print` / `println` are variadic stdout emitters: `Str` raw, other showables via `show`; no auto-newline on `print`** | Quoting every `Str` through `show` made hello-world and IR-shaped stdout unusable via `print`; bare `Str` bytes plus explicit `(print (show x))` when quotes are wanted keeps `show` injective and `write` as the arbitrary-fd primitive | Special variadic typing; six intrinsics; callers who wanted the old always-show behaviour must wrap with `show` |
---

## 2026-09-25 — `print` / `println`: bare stdout, ADR 39

### The decision

`print` and `println` take **zero or more** arguments and write to fd 1:

- each `Str` is emitted as **raw bytes** (no quotes);
- every other argument must be **showable**; its `(show …)` bytes are written;
- `print` adds **no** newline; `println` appends one `0x0a` after the args
  (`(println)` alone writes just that newline).

`show` is unchanged (still quotes `Str`). `write` remains raw bytes to an
arbitrary fd. Adds ADR 39; amends the §2.8.1 intrinsic set to **six**.

### Why

The previous rule — `print` = always `show` then write — made ordinary messages
and any stdout that must be byte-exact (including the shape of IR) wrong by
default: `(print "Hello, world!")` produced `"Hello, world!"` with quotes. The
fix needed was already named in §2.15 as `write`; elevating bare `Str` emission
onto `print` / `println` for **stdout only** keeps the common path short without
collapsing `show`'s injectivity.

Rejected alternative: `Str`-only print (option A). Accepted: option B — non-`Str`
showables still go through `show`, so `(print 42)` and `(print "x=" 1)` work.

### Propagated

§2.5, §2.8.1, §2.12 (Showable clients), §2.15 tier table and rule 1, `!` table.

---

## 2026-09-25 — Static objects: literals and nullary constructors

### The decision

> *"for me, str literals are static object rather than a heap allocated object.
> This usually has a positive gc impact. Same with the `None` singleton."*

Accepted for both, and generalised. Adds ADR 38; amends ADR 4 and ADR 9.

### The GC framing is right, and it understates the win

He is correct that this is good for the collector. But the gain is not collector
throughput — it is **allocation deletion**, and the two are not the same shape:

> `Str` is not interned, so without this **every evaluation** of a literal
> allocates. `(str-concat "foo" x)` in a loop allocates `"foo"` on every
> iteration.

A literal is a constant, and a constant that is rebuilt on every evaluation is
the purest form of waste. The same holds for a nullary constructor: `(None)` is
returned by every failed lookup in `map-get` and `arr-nth`, which in a compiler
is a hot path.

So the reason to record is: **a compiler's most frequent allocations are its
constants**, and static objects remove them from the allocation path entirely
rather than making them cheaper to collect.

### Generalised, and the generalisation is free

The decision as stated covers `Str` literals and `None`. It costs nothing to take
the whole class, and each extension has the same justification:

| Made static | Why it is the same argument |
|---|---|
| `Str` literals | The stated decision |
| **`Float` literals** | A `Float` is boxed (ADR 4), so a float literal is currently an allocation per evaluation, exactly like a string literal |
| **Interned `Sym` names** | Already static in substance — the spec described them as "immortal" objects holding name bytes. This decision makes the description honest |
| **Every nullary variant constructor** | A constructor with no payload is a constant. `None` is just the one that appears most |

The last entry is worth stating carefully, because it is the one that could have
gone wrong:

> Because every value is one word and no operation consults per-type metadata —
> types are erased — `(Maybe Int)` and `(Maybe Str)` have identical layout, so
> **one static `None` serves every instantiation**.

No specialisation, no per-instantiation singletons, no interaction with §2.8.4's
instantiation machinery. `(Empty)`, `(NotFound)`, `(Permission)` and every
payload-free constructor of a user variant come along for the ride. Note the
benefit this gives §2.15: the error paths of `spawn` and `IoError` are now
allocation-free.

### The hole this surfaced, which is the real finding

Working out where `Float` literals belong exposed a defect that had nothing to
do with the static pool:

> The specification said `Float` is "heap-boxed" but **never said which layout
> kind the box has**. Read as `ordinary`, its word slot holds an f64 bit pattern —
> and f64 bit patterns are very often even, non-zero words. `1.0` is
> `0x3FF0000000000000`. `2.0` is `0x4000000000000000`. `0.5` is
> `0x3FE0000000000000`.

Under `ordinary` layout, the collector's rule — "odd → skip, empty word → skip,
even non-zero → trace" — would have traced each of those as a **pointer to an
object that does not exist**. Not a rare edge case: essentially every convenient
float value. A crash, or silent retention, and *identically in both stages*, so
§2.14's gate would have been blind to it.

**The fix is one line and it was already licensed by the specification.**
Invariant 4 said byte payloads "are not words in slots at all; they are the bodies
of `bytes`-kind objects". A boxed `Float`'s f64 is exactly that: **a `bytes`
payload**. `Float` joins `Str` and a `StringBuffer`'s backing store.

This is the **third appearance of the same class of error** — the tag bit is
necessary but not sufficient:

1. v0.5's "even means pointer" ignored a closure's code pointer and an interned
   symbol (fixed by shape kinds, v0.5.1);
2. v0.5.4's restatement made the empty word the third case, and found that
   `mn_root_push` must initialise the slot;
3. this one, where an f64 payload is a fourth kind of even word that must not be
   traced.

Recorded because the pattern is now unmistakable: **every value that occupies a
slot without being a Menard value is a place where the collector must be told
what it is looking at.** The lesson from v0.5.1 — "any future non-heap even word
in a slot is a new case of the same bug" — was written down and then not applied
to the one type already in the representation table.

### The two axes, which the enum could not express

The static pool forced a restructure that is really a simplification. The old
four-value shape kind conflated two independent questions:

| Old kind | Layout | Location |
|---|---|---|
| `ordinary` | word slots | heap |
| `closure` | skip slot 0 | heap |
| `bytes` | no slots | heap |
| `immortal` | (borrowed `ordinary`'s) | static |

`ordinary`, `closure` and `bytes` are *layout*; `immortal` is *location*. One
enumeration could not express an interned symbol name — a `bytes` object that is
also static — and it could not express the objects the static pool now contains
(`bytes` + static literals, `ordinary`-header-only + static `None`).

So: **layout is the kind; location is a bit.**

| Layout kind | Collector rule |
|---|---|
| `ordinary` | odd → skip, empty word → skip, even non-zero → trace |
| `closure` | skip slot 0, then as `ordinary` |
| `bytes` | scan nothing |

| Location | Rule |
|---|---|
| heap | traced; swept when unmarked |
| **static** | a leaf: not traced, not marked, never swept, never written |

**The location bit also removes a temptation.** A collector with a `static`
category is one address-range test away from "is this pointer mine?" — the
classic trick that makes a collector depend on its own address layout and breaks
the moment it becomes a copying collector. Because the answer is in the
*descriptor*, the runtime never needs to ask about addresses, and the collector
stays free to move objects later.

### The tag word, removed

A nullary variant has no payload, so its **tag would be its only word slot** — and
its layout would then decide whether the collector scans a constructor tag. That
is the same class of question as the f64, arriving from a different direction.

It turns out not to be a question at all. The shape descriptor **already** carries
the constructor tag, and with one descriptor per constructor the inline tag word
is redundant. It is therefore dropped:

- a **nullary variant is header-only** — a single word;
- `match` switches on the descriptor's tag, or compares shape pointers directly
  for nullary cases;
- and **every variant object saves a word**, which matters because every `Ast`
  node is a variant.

**Accepted cost:** one extra load per `match` (header → descriptor → tag), which
LLVM usually hoists or folds. Taken in exchange for the word, and for the
disappearance of a layout question that had no good answer.

### Deduplication and emission order are determinism obligations

This is the consequence most likely to be missed, because it looks like an
optimisation. It is not:

> If stage0 deduplicated literals and stage2 did not, their IR would differ and
> the **gate would fail with no compiler bug behind it**.

Two static objects with the same bytes are interchangeable, so an implementation
may either keep both or merge them — but *which* it does is part of the program
image. The rule is therefore canonical rather than optional:

> **Deduplicate by byte content; emit sorted by byte content.**

Sorting is chosen because it is total, cheap, byte-defined, and shrinks the
image — and because "sorted" is a property a reader can check, where
"first-encountered in a deterministic traversal" is a property only its author
can check. §3.6 gains a row (obligations O and I), §3.7 gains a golden-test
layer, and §3.8 notes that a pool divergence shows up as a diff of two literal
lists — the same technique as the pass dumps, one level down.

### Two rules stated outright rather than left to be discovered

**Static-ness is invisible to the language.** No operation may distinguish a
static `Str` from a heap one, a literal from a computed value, or a static
nullary constructor from a freshly built one. There is no address comparison and
no `is-static`, and §2.16 forbids `dump` from reporting it — fd 2 is not an
excuse, because the point of the rule is that *no operation may notice*. This
invisibility is what makes deduplication safe in the first place: if two
occurrences of `"foo"` could be told apart, merging them would be a semantic
change.

It also falls out of ADR 18, which is why it needed no new predicate work: `Str`
equality and order are defined on bytes (§2.3), and a nullary constructor
compares on the descriptor's tag. A static literal and an equal heap `Str` were
already indistinguishable to `show`, `=` and `compare`. The rule states what was
already true rather than adding a constraint.

**A `StringBuffer` never adopts static storage as writable.** Its backing store is
always heap-owned. The existing copy-on-write rule (ADR 34) already implies this,
since sharing forces a copy before the next in-place write — but it should be
said, because `.rodata` is not writable and a "helpful" optimisation that pointed
a buffer at a literal would be a fault rather than a slowdown.

### A fence, so the pool cannot quietly grow words

No static object holds word slots. Everything in the pool is `bytes`-kind or a
header-only `ordinary`, so this is true by construction. If a static object with
word slots is ever wanted, the invariant *a static object's slots hold only
immediates, the empty word, or other static objects* becomes required, and must
be asserted in heap-verify. Stated now because the alternative is discovering it
the way the f64 was discovered.

### What was considered and rejected

- **Interning `Str` instead of making literals static.** Tempting, since `Sym` is
  already interned, but it changes `=` from "bytes" to "bytes, and here is a
  lookup" — an observable difference in cost, a hash table on the runtime's
  critical path, and a new cross-stage agreement requirement on the hash. Static
  literals get the allocation win with none of that.
- **Leaving `Float` literals heap-allocated** while making string literals
  static. Rejected as inconsistent: a boxed `Float` literal has exactly the same
  allocation profile as a `Str` literal, and the `bytes` payload fix was needed
  regardless.
- **A per-instantiation `None` singleton**, or specialising the representation so
  that `None` is a tagged immediate. Rejected: uniform one-word values mean one
  static `None` already serves every instantiation, and a special representation
  would be a second axis of stage divergence for no gain. (This also finally
  closes the v0.5.4 question: a **null-as-`None`** encoding buys nothing beyond
  the singleton, and the singleton now exists.)
- **Keeping the inline constructor tag** for the sake of one fewer load on
  `match`. Rejected: the descriptor already holds the tag, so the word was
  redundant; and a nullary variant's untagged word would have been a collector
  question with no good answer.

### Propagated

§2.2 (representation table; invariants 2–4 restated for static objects and
8-alignment; `Float` as `bytes`), §2.2.1 (rewritten as layout + location + the
static pool; the open question from v0.5.4 now answered), §2.3, §2.4 (`match`
lowering), §2.8.1, §2.8.2 (buffer storage is heap-owned), §2.8.4, §2.10, §2.11.I,
§2.11.O, §2.13, §2.14, §2.15, §2.16, §3.1, §3.2, §3.3, §3.4, §3.5, §3.6, §3.7,
§3.8, §3.9, §3.10, §4.1, §4.2, §4.3, §4.4, §5, §6, §7, §8, §9.

Sizing moves by ~120 lines: the pool itself in each stage (Menard 60, TypeScript
60). Totals become **~7,020 Menard / ~2,940 C / ~5,030 TypeScript**, about 15,000.
The runtime column does not grow — recognising the location bit is a branch, not a
subsystem — and the *machine* work falls, which no line count records.

**The one question this leaves open** is whether the static pool should be
size- or position-limited in any way; it currently has no bound beyond the source
text, which is the right default but should be revisited if a generated source
ever produces a very large pool.

---

## 2026-09-25 — The specification is rewritten as a specification

### The instruction

> *"I would like you to rewrite the spec to be 'this is the specification'
> rather than a dialogue with oneself referencing version changes. Just the
> latest will do and the intellectual path to arrive at this point can be
> dropped. Please rename the current file to menard-spec-draft.md and the updated
> to menard-spec.md. I am happy that decisions.md contains all the decision
> points to get to this final result."*

### What changed, and it is a change of *kind*, not of content

Every normative statement survives. What is removed is the apparatus of a
document arguing with its own past:

- **§11 Revision history** — deleted outright. The dated entries below are its
  proper home, and they are more complete than it was.
- **The §6 decision log** — moved here as the decision index above, where it
  belongs. The specification no longer cites `ADR` numbers, which is the point:
  a specification should be readable on its own.
- **"An earlier draft said X"** — there were roughly a dozen such passages, in
  §2.2.1, §2.8.1, §2.8.2, §2.8.4, §2.9, §2.11, §2.11.O, §2.12, §2.15, §2.16 and
  §4.3. Each is replaced by the rule or the reason stated directly. Where the
  *reason* was the residual value — "the tag bit is not a sufficient
  classification rule", which was once a correction — it is kept as a
  forward-looking statement rather than a confession.
- **The operator's voice** — quoted questions and my answers to them are gone
  from the specification; the answers are now simply the text. They remain in
  the dated entries here, which is where a record of a conversation belongs.
- **"Vera's finding 2 in a new dress"**, "which an earlier draft missed", "the
  honest amendment", "this section was missing" — all removed.
- **One behavioural statement was *strengthened* while de-historicising it.**
  §2.11.B previously said the obligation "is now governed by a structural marker
  rather than a naming one"; it now states the marker rule without the temporal
  "now".

### What is *not* lost

The two things most at risk in a rewrite of this kind, and where each now lives:

- **The rejected alternatives.** Every "considered and rejected" passage is kept
  verbatim in substance — `MutBytes`, the `Debug` value type, `--no-debug`
  elision, a naming prefix for ambient functions, marking only ambient writes,
  shell strings, `fork`, monomorphization, dictionary passing, call-site ordering
  predicates. A specification is more useful for saying what it is *not* than
  for saying only what it is, so these stayed.
- **The open question** about `Str` literals and the `None` singleton (§2.2.1)
  was retained at the time, marked as unresolved rather than as a flag on a
  revision. It was answered later the same day — see the entry above.

### The file layout

| File | Role |
|---|---|
| `menard-spec.md` | **The specification.** Present tense, no versions, no history. |
| `menard-spec-draft.md` | The frozen v0.5.x working draft, with its revision history and decision log intact. Reference only. |
| `decisions.md` | This file. Decision index, dated entries, unresolved questions. |

The draft is kept rather than deleted because the two documents answer different
questions: the specification says *what Menard is*, and the draft records *how it
got there*. The draft is frozen — it will not be updated, and where it disagrees
with the specification it is wrong.

### A note on the mechanism

The rename could not be done with `mv`: `run-bash` executes in a container whose
`/workspace` is a different, empty virtiofs mount from the one the file tools
read and write. The draft was therefore created by reading the old file and
writing it back under the new name, byte for byte, and the specification was
written fresh. Worth recording because it is a property of the environment, not
of the project, and the next person to reach for a shell here will hit it too.

---

## 2026-09-25 — v0.5.6: `!` marks mutation only; `extern` marks the OS

### The question

> *"I think the `!` syntax on library calls is looking a little strange. Do we
> need it? Should we perhaps limit the `!` suffix to memory state changes rather
> than environment updates?"*

Yes to the second half, and the first half answers itself once you see what was
wrong.

### The conflation (ADR 30, rewritten)

v0.5.5 gave one suffix to two different ideas:

| Was marked `!` | The idea |
|---|---|
| `set!`, `sb-append!`, `sb-clear!`, `sb-take-str!` | **Mutation of a value reachable from an argument** |
| `print!`, `write!`, `dump!`, `read-file!`, `exit!`, `spawn!`, … | **Any contact with the outside world** |

`!` now marks the first and only the first. Precisely:

> `!` marks a call that changes state the caller can still observe afterwards:
> mutation of a value reachable from an argument. *Observable* is the operative
> word — memoisation the caller cannot see does not qualify (`sb-to-str`), and
> neither does talking to the operating system, because a stream is not a value
> you hold.

### Why this is the original meaning, and what v0.5.5 had added to it

Scheme's `!` is mutation: `set!`, `set-car!`, `string-set!`. There is no
`display!` and no `read-char!` in Scheme. So v0.5.5 had *extended* the convention
from mutation to **purity** — which is the territory of an effect system, the
feature §1.3 refuses.

**The irony is worth recording, because it is the real diagnosis.** The spec
refused effect systems and then used its one marker to gesture at effects. That
gesture could never be completed: the convention does not propagate, so a
function calling `print` is not itself marked, and a reader of a call to that
function learns nothing. So `!` was carrying a meaning it could not deliver — a
half-made promise about purity sitting beside a complete one about mutation.
Withdrawing the half is the fix, not a compromise.

### The payoff is a pair the spec already cared about

`sb-to-str` **loses** its `!`; `sb-take-str!` **keeps** it.

That is exactly the distinction a reader needs — *who owns the backing store?* —
and it is precisely the distinction a blanket marker destroyed by marking both.
This is ADR 34's copy-on-write rule and the v0.5.2 exchange about consuming
versus non-destructive conversion, now visible in the names rather than only in
the prose. Three revisions of argument about `sb-to-str!` versus `sb-take-str!`
were, in retrospect, an argument about the `!` rule.

The full population of `!` in the language is therefore **one special form and
four functions**. Applying the rule is a decision about five names rather than a
judgement call on every I/O call — which matters, because the rule is still not
checked.

### What replaces it at the boundary: `extern`, confined by module

The one genuinely useful thing the old marker did was name the §2.11.B boundary —
*this can reach outside the fixed point*. That is now carried by a mechanism that
already existed:

> Every ambient operation is an `extern`-backed wrapper, and `extern` bindings are
> confined to `stdlib/sys.mnd`, `io.mnd`, `fs.mnd` and `proc.mnd`.

So the boundary is **structural and enforceable** where the convention was
neither. A module cannot reach `write(2)` without importing the module that
declares it, and a CI lint can refuse an `extern` — or an import of those four —
anywhere else.

**What is lost, stated plainly:** one-glyph greppability for "can touch the
outside world". **What is gained:** the audit moves from a naming habit that
nobody checks (ADR 30 says so explicitly) to a module boundary the compiler
checks and a lint can enforce. That trade is why the answer is yes rather than
"it's a matter of taste". §2.11.B, §3.6 and §9 were restated accordingly.

### Two alternatives, considered and rejected

- **Mark only ambient *writes*** (keep `!` on `write-file`, drop it from
  `read-file`). Rejected as **backwards for this project**: the fixed point's
  hazard is an *input* reaching an output, so `read-file` is the live threat,
  while `write-file` is how the compiler does its job. Marking writes and not
  reads gets the threat model exactly inverted.
- **A naming prefix** (`io-print`, `sys-write`). Rejected as visual noise on a
  large fraction of the compiler's statements, when the module boundary already
  carries the same information in a form the compiler checks.

### A consistency fix that falls out

`panic` is a special form and was never marked. `exit!` is a seam function and
was. They are the same kind of operation — the program stops — and under the new
rule neither is marked. A one-glyph rule with two meanings produced an
inconsistency between two operations of the same kind; a rule with one meaning
does not. (Still true after the static-objects change: neither is marked, and
neither is a static pool member.)

### Propagated

§2.1 (hygiene rule kept, meaning reduced), §2.5, §2.7 (`extern` confinement),
§2.8.1 (none of the five intrinsics is marked), §2.8.2 (the buffer table now
shows which operations mutate), §2.8.3, §2.10, §2.11.B, §2.13, §2.15 (two
markers, ten spawn rules, six seam rules, `IoError`), §2.16, §3.6, §3.7, §3.9,
§3.10, §7 (ADR 27 and ADR 30), §6, §8.

Renames: `print!`→`print`, `write!`→`write`, `dump!`→`dump`,
`read-file!`→`read-file`, `write-file!`→`write-file`, `append-file!`→
`append-file`, `read-stdin!`→`read-stdin`, `list-dir!`→`list-dir`,
`getenv!`→`getenv`, `exists!`→`exists`, `remove!`→`remove`, `rename!`→`rename`,
`exit!`→`exit`, `spawn!`→`spawn`, `spawn-capture!`→`spawn-capture`,
`sb-to-str!`→`sb-to-str`, `find-on-path!`→`find-on-path`. Unchanged: `set!`,
`sb-append!`, `sb-append-byte!`, `sb-clear!`, `sb-take-str!`,
`sb-append-show!`.

**Sizing unchanged** — the change removes a suffix and moves a boundary marker
onto a mechanism that already existed.

### A sequencing note the operator raised at the same time

> *"As soon as the stage0 has been completed, I can then use Menard to build
> project tooling. That will be the best thing ever :-)"*

True, and slightly pessimistic. **Phase 1 is the interpreter and phase 2 is
stage0**, so anything that does not need to *compile* — prelude libraries, a
formatter, a test runner, `find-on-path`, span handling — can be written and
tested on the interpreter before a native binary exists. The oracle *is* a Menard
runtime. Only the driver needs stage0, because it needs a Menard binary to run,
which is why it lands at the end of phase 3. Recorded in §5 so the plan reflects
it.

---

## 2026-09-25 — v0.5.5: `exec` is admitted, in argv form

### The correction

> *"Not sure that we can exclude exec. The language will need to be able to
> compile and run programs. It uses exec for this. I would like to have a CLI
> tool, written in Menard, that'll be able to run the compiler, and linker, to
> building binary files."*

He is right, and v0.5's refusal was **drawn around the wrong word.** The refusal
read: *"`exec` in particular is refused for v1: it is the largest ambient-state
hole in the list and no client needs it."* The second clause was false — there is
a client, and the client is the language's own build tool — and the first clause
was true of **one form of exec and not the other**.

### The split that should have been there from the start

| Form | The caller writes | Verdict |
|---|---|---|
| Shell string | `"cc -O2 -o out out.ll"` | **Refused, permanently** |
| **argv vector** | `(list cc "-O2" "-o" out ir)` | **Admitted** |

**Shell strings are refused forever**, and the reasoning is not squeamishness: a
command string is unbounded ambient state in one string. The shell performs word
splitting, quoting, globbing, variable expansion, command substitution and `PATH`
lookup, and **none of it is visible in the Menard source or controllable by a
test**. A hermetic test suite cannot exist around it.

**argv-vector spawning is admitted**, and the decisive argument is not "less
dangerous" but *safer*: the argument list has **already been split by the
caller**, so there is no re-parsing step and nothing to inject, and — the part
that matters most here — the argument list is **data the compiler can see,
type-check, print and diff**. A build whose command line is a `(List Str)` can be
tested by comparing two lists. A build whose command line is a string can only be
tested by running it.

So the strongest argument against exec-ing was always an argument against the
**string** form. v0.5 applied it to both, and that was the error. This is now the
third revision in a row where an operator question exposed a **conflation** —
showable-versus-emitted in v0.5.3, representation-versus-semantics in v0.5.4, and
shell-versus-argv in v0.5.5 — and v0.5.6 made it four, with mutation-versus-purity.

### Why the client is real, and not just convenience

The tempting counter — *"a Makefile can run `clang`; the compiler only needs to
emit IR"* — is true and irrelevant, because it describes a different product:

- If the top-level build command is a shell script, then **the language's own
  integration test has been moved out of the language.** The driver exercises
  arena construction, `argv`, string handling, file I/O, `Result`, exit codes and
  process spawning in a single real program. That is a better test of the runtime
  than any corpus file, and writing it in a shell throws it away.
- The cost is small and of a kind already budgeted: ~160 lines of C, ~150 of
  TypeScript, and a closed error variant — **less than `Map`**, and the same kind
  of work (a narrow interface implemented twice), which is exactly why the §2.8
  tier rules were worth having *before* this decision was taken.
- A driver cannot precede self-hosting anyway: it is a Menard program and needs a
  Menard binary to run. So it lands at the end of phase 3, as a **second
  acceptance test** rather than a second deliverable.

### The ten rules, and where they come from

Two operations only — `spawn!` (child uses our stdio) and `spawn-capture!` (pipes
it, feeds it a `Str` on stdin). Six rules exist because **two implementations must
agree**; four exist to keep the surface from becoming a process-control library.

1. No shell, ever.
2. **No implicit `PATH` lookup.** `argv[0]` resolves as a path, so a bare name
   means `./name`. A caller wanting a search calls `(find-on-path!)` from the
   prelude, which reads `PATH` **in visible Menard code**. Same principle as
   `dump!`'s isolation: ambient influence that determines *which program runs*
   should be written down, not hidden in a primitive. It also kills a real class
   of build bug — *"which `clang` did I actually get?"* — by construction, which
   is what `mn --print-toolchain` then prints.
3. Environment inherited — a hole the **caller** owns, and distinct from rule 2:
   the environment may affect *how* a known program behaves, never *which*
   program runs.
4. cwd inherited; no `chdir!` (process-global mutation that would make every
   relative path depend on where the program had been).
5. **A NUL byte in an argument is `InvalidArgument`, never a truncation.** The
   one place in the language where a `Str` is *judged* rather than passed
   through, because `Str` is arbitrary bytes and POSIX argv is NUL-terminated.
6. **Exit statuses are not conflated.** The kernel's two outcomes stay apart,
   because a build that reads `SIGSEGV` as "exit 11" reports a crash as a status.
   The shell's `128 + n` folding is not adopted by the primitive; it lives in
   `status->exit-code`, in the prelude, where it is visible. `(exit!)` truncates
   to 8 bits, identically in both stages.
7. **No `fork`. Refused permanently, and the reason is specific to this project:**
   a GC'd runtime that forks copies the heap *and the collector's and allocator's
   state* — a half-filled object, a shadow stack that no longer matches the
   machine stack, a nursery pointer into a copy-on-write region. `posix_spawn` is
   "a fresh image with a fresh heap", and since the interpreter's host cannot
   usefully fork either, this rule doubles as an agreement rule on what a child
   *is*.
8. **No signals, timeouts, `kill`, or streaming.** `Signalled` is reported and
   nothing else; the parent installs no handlers and forwards nothing; stdin is a
   whole `Str` up front. A hung child hangs the build, and that is v2's problem.
   Refusing them **as a group** is what keeps this from growing into a
   process-control library — each is plausible alone, and none serves a compiler.
9. Errors are a closed Menard variant; no `errno`, no `strerror`.
10. **`Unsupported` is the interpreter's escape hatch**, so the hermetic corpus
    claim is enforceable: spawning is *disabled by default* there.

### The asymmetry that keeps the fixed point safe

This is the part worth remembering, because it is what makes an "ambient state
hole" harmless:

> The compiler's **output** never consults a child. The driver runs the compiler;
> the compiler emits IR; IR emission is a pure function of the source. So the
> toolchain may determine whether a build **succeeds**, never what the compiler
> **emits**.

Obligations O, I, T and A (§2.11) are untouched, and §2.11.B's rule carries the
weight. Two greppable rules follow: **a child never inherits the descriptor
carrying the artifact** (`mn emit` spawns nothing), and **captured child output
is never compared** (clang's stderr contains paths and versions).

### The driver, and the second acceptance test

```
mn emit | check | build | run
```

- Intermediates go **beside the output**, never in `TMPDIR`; `(rename)` makes the
  build atomic, so an interrupted or failed build **never leaves a stale
  artifact** — which is what makes it safe to interrupt `make bootstrap`, and what
  stops a later gate run from comparing a half-written binary.
- Toolchain paths come from flags with build-time defaults. **No `PATH` lookup**
  (rule 2), so `--cc` or the recorded default decides.
- `mn run` maps the child's status to its own exit code via `status->exit-code`.

**And the driver is now inside the gate's coupled surface**: if the artifacts are
produced by the driver, then its `argv` construction, path handling and spawn
ordering are part of what must be deterministic. Hence a **new success
criterion** — the artifact `mn` produces must be byte-identical to the harness's
— which is the best end-to-end test of the runtime the project has, and one that
no IR comparison would catch.

### A pre-existing hazard this surfaced

Once a driver hands paths to `clang`, an absolute path has a **new route into the
artifact**: through the IR's `source_filename` and module identifier, which the
compiler emits. Rule now stated explicitly in §2.11.I: those derive from the
module path **as the user gave it**, never from a resolved absolute path. It is
deterministic by construction because the gate supplies the same path to both
stages — and it is the sort of thing that breaks by calling a path-normalising
helper "for tidiness".

### The test tier this creates, and why it is fenced

**Spawning and the virtual filesystem do not compose**: a child is a real process
on the real filesystem, and the interpreter's virtual FS does not extend into it.
So rather than weaken the hermetic claim, it is made *checkable*:

- the interpreter runs with spawn **disabled**, every call returning
  `(Unsupported)`;
- a **stub child** echoes its `argv` and exits with a scripted status, so the
  driver's argument construction is asserted **exactly**;
- `tests/proc/` is the only tier that spawns for real, and it is named as
  non-hermetic rather than quietly exempted.

### Propagated

§1.1 (a build tool written in its own language), §1.2 (eight criteria), §1.3
(non-goals: shell strings, `fork`, signals, timeouts, per-spawn env/cwd, streaming
child I/O), §2.5, §2.10, §2.11.B (the spawning case as the clearest instance of
the boundary rule), §2.11.I (absolute paths), §2.15 (Tier 1½; the refusal of
shell strings and `fork` moved into Tier 2's permanent list; the driver), §3.1,
§3.4, §3.5, §3.6, §3.7, §3.8 (driver bugs are `argv` diffs), §3.9, §3.10, §4.1,
§4.2, §4.5, §5, §6, §7, §8.

**Still open at the time:** the static-literal / `None`-singleton question
(v0.5.4). Phase 0 — the TypeScript reader, AST, printer, spans and casing check —
remains the next build step.

---

## 2026-09-25 — v0.5.4: no `null`; the empty word is a sentinel, not a reference

### The observation

> *"We don't have a null pointer in Menard. We therefore don't need a pointer
> reference to one."*

He is right about what the word **is**, and the spec was wrong to call it "null".
It is not a reference to anything, because there is no null object for it to
point at. The name invited precisely the reading he had — *this looks like a
Menard value* — so the name is gone throughout. §2.2 now says **the empty word**,
and §2.10 says plainly that there is no `null`, no operation returns one, and no
`deref` needs a null check.

### But the word survives, and the reason is not about the language

It is load-bearing for allocator hygiene, and the mechanism is unavoidable:
**a freshly allocated object is filled field by field, and filling a field may
itself allocate.** `(cons (leaf 1) (leaf 2))` allocates the two leaves before it
has finished the cons. So the collector can run while an object has unwritten
slots.

Without a distinguished word, those slots hold whatever the memory held before: a
**stale pointer** into a freed object, or an **even non-pointer** such as a code
pointer. Either is traced, and either fails **silently and deterministically in
both stages** — §2.14's blind spot exactly. With the empty word, the worst case
is a wasted read.

### The part that is actually his point: demote it from mechanism to backstop

His instinct is right if it means *the design should not depend on it* — and it
should not. So a stronger obligation is now stated, and **asserted in
heap-verify**:

> **No published object ever contains the empty word.** Every slot is written
> before the object can be reached by the collector, by a root or by another
> reachable object.

That is an emitter and allocator obligation (evaluate fields, then allocate, then
store, with no intervening allocation), and it is checked rather than assumed.
The pairing is deliberate and worth recording as a principle:

> **Without the net, violating the discipline is corruption; with the net alone,
> violating it is invisible.**

Providing both is what makes the sentinel cost one test and buy a whole failure
mode. The collector no longer *depends* on the word; the word is what makes a
mistake cheap while the assertion is what makes a mistake loud.

### A real bug this surfaced: `mn_root_push` must initialise the slot

If the empty word is load-bearing anywhere, it is here. A root slot is
`alloca` output and holds the previous frame's dirt on entry; a collection
between the push and the emitter's first real store would trace stack garbage.
**`mn_root_push` now writes the empty word into the slot before pushing it.** One
store, and an entire class of intermittent crash disappears. This is the only
place the empty word is written deliberately, and it is why the second legitimate
occupant of the word does not survive as a live case.

### Zeroing is now justified, not asserted

`mn_alloc` zeroes the body — and (§4.2) this is why: it is what makes the empty
word work, in both directions, including **recycled** objects from the free list,
which must be scrubbed before being handed out. Bump allocation from fresh pages
needs no work; the cost is one `memset` per promoted object.

The collector's rule was also restated so it cannot be misread (§4.3, §2.2.1). It
is **not** "odd means immediate, even means pointer". It is: odd → immediate; the
empty word → nothing; even non-zero → pointer, and the *shape kind* says whether
that is a heap object, a static object, or a code pointer. The word is the third
case, not a special kind of value.

### Consequence worth keeping: `immortal` generalises

`immortal` was "interned symbol"; it is now "**statically allocated**", because a
`None` singleton and (probably) string literals belong there too. That raises a
question the spec had not asked:

> Is a `Str` **literal** a static object or a heap allocation, and is `None` a
> per-instantiation static singleton?

**Flagged as open, not decided** — and answered the next day in the static
objects entry above, in favour of yes to both, generalised to every nullary
constructor and to `Float` literals. The observation recorded here that survived
the answer: a **null-as-`None`** encoding buys nothing beyond the singleton, so
the absence of a null *value* is *available* as an `(Maybe T)` representation for
pointer-shaped `T`, and is **not needed**. Which is a nice inversion of the
operator's own point: because null is not a value, it could be a representation —
and the reason we don't bother is that the singleton is now free.

Note also that this entry's `immortal` was, in hindsight, a **location wearing a
layout's clothes** — the conflation the static-objects entry untangles by
splitting the enum into a layout kind and a location bit.

### The general lesson

> **A language can have a distinguished word in its heap representation without
> having that word in its semantics.**

Every revision had used the two interchangeably, and the naming carried the
error. §1.3 now lists `null` as a non-goal; §8 requires that the empty word
appear in no Menard type, no canonical text form and no debug output; §6 gains a
risk row for mistaking it for a language feature.

---

## 2026-09-25 — v0.5.3: `dump!`, and a gap the spec had been hiding

### The question, and what it exposed

> *"Can a string buffer not show the string representation of the buffer? Really
> helpful for debugging."*

It can — but the more important outcome is that **the question found a hole in
the spec that had been there since v0.4.** Every revision from v0.4 onward
justified making `Ref`, `Fn` and `StringBuffer` non-showable by saying that
"debug printing is isolated" (§2.13, ADR 18's disposition), and **no such
operation was ever defined.** It was cited as the safety valve for a restriction
while not existing. Now it does: **§2.16, `dump!`**.

Worth recording as a failure mode of its own: a document can cite a mechanism as
justification for a restriction, repeatedly and in good faith, without that
mechanism ever being written down. The citation is the thing that stops anyone
checking.

### Answered directly, first: the contents are already visible

Three routes existed even then, none needing a language change:

- `(write! 1 (sb-to-str! sb))` — contents, byte-exact, stdout;
- `(show (sb-to-str! sb))` — quoted form, for a message;
- `sb-length` / `str-byte` — raw inspection.

So the *need* was already met. What was missing was a printer for the cases where
the type system deliberately refuses.

### Re-argued, and the argument is stronger than the one in the spec

Why `show` must refuse `Ref` and `StringBuffer` — and this is a better argument
than the "mutable, hence run-dependent" line that was then in §2.12:

**For both types, the value *is* the identity; the contents are other values.**
Therefore:

- A contents-based `show` would not be a function of the value: two distinct
  buffers holding identical bytes are distinct values that would print
  identically, breaking §2.13's requirement that the text be **injective over a
  value's bits**.
- Any contents-based order would be **inconsistent with the equality** §2.12
  defines for them (identity) — so they cannot be orderable either, and this
  falls out of the same fact rather than being a second decision.
- And the practical one: **showability composes.** A showable buffer makes every
  record, list and map containing one showable, so a buffer's *current contents*
  could reach an emitted byte several files from the mistake. Crossing that
  boundary explicitly is a deliberate, greppable act (`sb-take-str!`, and since
  v0.5.6 `sb-to-str` unmarked); `show` would be silent.

Note what this does *not* claim: it is not that a showable buffer would
necessarily break determinism — a deterministic program has deterministic buffer
contents. It is that `show` would stop being a function of a value, and that the
identity discipline would leak by composition. Those are the real objections.

### The design: isolation by type, not by convention

```lisp
(defn (dump! [a]) (v: a) -> Unit    ; loose structural text to fd 2
```

**The isolation rule, and it is the whole design:**

> `dump!` writes only to fd 2. Debug text **has no way to become a value.**

No `Debug` type, no accessor, one consumer — the fd-2 writer. So debug text
cannot reach an emitted byte by accident, through a container, through a `show`,
or through an alias.

**The payoff is the property you actually want:** a **forgotten `dump!` cannot
break the fixed point.** No cleanup pass before a bootstrap run, no discipline
required, and a debug call left in a hot path costs one write to fd 2. That is
why it is safe to sprinkle, and it is the reason the isolation is structural
rather than a convention — the `!` convention (then ADR 30) is unchecked by
design and could not have carried this.

**Consequence, unusual enough to state:** `dump!` output is the only thing in the
system permitted to be **non-reproducible**. It may contain addresses and may
differ between stage0 and stage2 — permitted *because* it cannot be an emitted
byte.

**Rejected alongside:** a two-step design with a built-in nominal `Debug` type
(buys composability, loses the guarantee the moment anyone adds an accessor —
recorded as the v2 path, to be taken deliberately or not at all), and
`--no-debug` elision (eliding a call skips **evaluating its argument**, which may
have effects — the effect-system question §1.3 excludes). §1.3 now lists "debug
text as a value" as a non-goal.

### Loose policy, one engine

`dump!` is the same traversal as `show` with a different policy — one memoisation
table, one termination argument, so the two cannot drift where they overlap. It
extends `show` as follows: `Ref` → contents (never the address); `StringBuffer` →
contents plus byte length; `Fn` → symbol-or-address **plus the environment**.
That last one is deliberate: closure capture (§2.6) is a predictable thing to
need to debug in this project, and the environment is what goes wrong.

### A silent assumption made explicit

`show`'s termination argument **depends on immutability** — immutable structures
cannot be cyclic, so structural traversal terminates by construction. `Ref`
breaks exactly that. So `dump!` needs a fixed depth cap (16) and prints `...`,
rather than a visited set (no per-call state, cannot itself diverge, trivially
identical in both hosts).

Worth recording for its generality: any future change that makes cycles
constructible in a *showable* type would move `show` outside the fixed point and
make the gate fail intermittently. That is one more reason the reference-type
list is closed (§2.3) — and it is why static objects, which are immutable and
fully written at compile time, cannot reintroduce the problem.

### Two kinds of text on stderr, with opposite rules

The new trap, stated because it is silent:

| | Compiler diagnostics | `dump!` output |
|---|---|---|
| Deterministic? | **yes — required** (§3.7 byte-compares messages) | **no** — may contain addresses |
| Compares in tests? | yes | **never** |

So: never call `dump!` from a diagnostic path, and never byte-compare its output
(capture fd 2 and assert structurally). Three mechanisms, three contracts: `show`
is the canonical text *in* the artifact, diagnostics are deterministic human text
*beneath* it, `dump!` is non-reproducible text that must never be either.

### Honest amendment: the intrinsic count

v0.5.2 said the compiler-known set was "**exactly four**". That was wrong. The
*criterion* was right — "needs per-type synthesis" — and it produced the wrong
count, because §2.16's debug printer needs exactly that machinery. **It is five**
(§2.8.1). The correction is recorded rather than quietly fixed, because a count
stated emphatically is what future additions get justified against.

### Naming corrected in the same pass

v0.5.2 listed the stdout printer as `print` in §2.8.1 and as `print!` in the
§2.15 seam — a straight inconsistency. The seam spelling won at the time; v0.5.6
removed the suffix from both, so the inconsistency is now moot.

**`dump!` rather than `print-debug!`**, on greppability: you want to find every
debug call in a codebase, and `dump` cannot be confused with `print` or `write`
in a grep. v0.5.6 kept the name and dropped the suffix, which strengthens the
point rather than weakening it. The static-objects entry adds one constraint:
`dump` must not report static-ness, because no operation may notice it.

### Propagated

§2.11.I rescoped to **emitted bytes** (narrower than "everything ever written"),
with §2.16 as the named exception; §2.3, §2.7, §2.12, §2.13, §3.6, §3.7, §3.8,
§4.5, §5, §6, §7, §8 all updated. §4.5 gains **flush stderr before `panic`** —
the practical half of the debug story, and the difference between having the last
debug line before a crash and not.

---

## 2026-09-25 — v0.5.2: `StringBuffer` is built in, and a mispricing corrected

### Ratified by the operator

Three in one line, and the first two were already written in v0.5.1 as
recommendations, so this confirms rather than changes them:

1. **`Map` instances are immutable** — value semantics, structurally shared.
2. **`Map` keys must be orderable.**
3. **Equality must exist across all instances.** `Equatable` is a total
   predicate, not a subset of the other two: `Ref`, `StringBuffer` and `Fn` are
   equatable by identity even though none of them is orderable or showable.

### Ratified by the operator, over my recommendation: `StringBuffer` is a built-in

The operator's stated reason was that `toString` would then be efficient. He
pushed back after I recommended prelude implementation, and he was right to —
because **my reasoning was wrong, in a way I had written into the spec.**

**The correction.** I had priced a built-in buffer at the cost of **opaque extern
types** — the abstract-type feature deferred in §2.7. That price is only correct
for an `extern`-backed type whose C layout the typer cannot see. A **built-in
nominal type** — exactly the treatment `Map` receives — needs **no new language
feature at all**. The real cost is a few hundred lines implemented twice.

**The consistency argument that settles it.** `Map` was admitted to the
runtime-backed tier *precisely because it needs in-place mutation*. A string
buffer needs in-place mutation too. Refusing one while accepting the other makes
the tier rule arbitrary. So the tier rule's second clause is now stated
explicitly: an operation belongs in §2.8.2 when it needs in-place mutation **and
the compiler itself is a client that needs it on a hot path**. A criterion with a
named client, not an open door.

**What the built-in actually buys:** `sb-take-str!` is `O(1)` (shared payload
shape → pointer move, saving the largest allocation the compiler makes);
`sb-to-str!` is `O(1)` on repeat (cached); and append allocates no cons cell (the
dominant cost under a bump-allocating nursery).

**And the honest floor**, recorded so the built-in is not mistaken for necessity:
a chunk list is linear time and would pass the gate, and a compiler can stream
chunks to stdout with `write!` and need no buffer at all. The built-in buys
constants and one avoided copy, not asymptotic safety.

### The design that came out of the exchange

My first instinct — a consuming `sb-finish` — was worse, and the operator's
prompt produced a better shape. Consuming means **use-after-finish**, an affine
discipline the language has no machinery for. Instead:

```lisp
(sb-to-str! ...)   ; non-destructive, cached      → sb-to-str   since v0.5.6
(sb-take-str!)     ; transfers storage; buffer becomes empty
```

`sb-take-str!` transfers and leaves the buffer **empty and valid** — no hazard,
total function, and the `!` is honest because it does mutate.

**And this pair is what eventually broke the `!` rule.** Three revisions argued
about `sb-to-str!` versus `sb-take-str!` while both carried a `!` that
distinguished nothing. v0.5.6's rule is the resolution: the non-destructive one
loses the marker, and the pair now reads the way it always should have.

The static-objects entry adds one clause to this pair: **the backing store is
always heap-owned**. Sharing with a `Str` is what copy-on-write is for; adopting a
*static* payload would mean writing to `.rodata`.

### ADR 34: copy-on-write after a non-destructive `sb-to-str!`

Because a `Str` handed out by `sb-to-str!` **shares** the backing store, the
buffer's next append must **copy before writing in place**; otherwise an append
mutates an immutable `Str` a caller already holds. A **semantic** rule, not an
implementation detail, because it is implemented twice.

The **TypeScript hazard runs the other way**: in C, sharing a payload is a
deliberate act; in TS a `Uint8Array` handed to a `Str` is not copied by default,
so sharing is the *natural* thing to write. A stage0 author would get this wrong
by doing the obvious thing, and if the C runtime made the same mistake the gate
could pass. Flagged explicitly in §3.9 as the one built-in with a host-specific
trap.

### Rejected: a general `MutBytes`

Considered and rejected as the alternative primitive: a mutable byte array
built-in, with `StringBuffer`, growth and `to-str` all in the prelude on top.
Smaller and more general, and it would unlock efficient growable arrays — but it
opens a **general mutation door** rather than one purpose-built cell whose
predicates are non-showable and non-orderable **by construction**. Recorded as
the v2 option; §1.3 now lists general mutable arrays as a non-goal.

### Propagated

Shape kind **`string` renamed `bytes`** (§2.2.1); **ADR 5 amended** to exactly two
enumerated reference types; §2.11.I's identity list extended; §2.13 gains a "no
spelling" row; §4.2/§4.4 gain `mn_realloc`; §6 gains two risk rows; §7, §8
propagated. The static-objects entry later widened `bytes` further, to carry a
`Float`'s f64 as well — which is the same shape doing the same job a third time.

A **third mispricing** joins the record from v0.3 and v0.4, with the same lesson:
**the cost is in the typechecker and the runtime, not the backend.**

---

## 2026-09-25 — v0.5.1: the surface, the seam, and the collector's shape kinds

### Ratified by instruction: the intrinsics go in the spec (§2.8)

Asked directly, and agreed. But the useful move turned out not to be a *list* —
it was a **placement rule**, which answers "what are the intrinsics" and "where
does a string buffer live" as one question:

| Tier | Rule | Implemented | Spec'd? |
|---|---|---|---|
| Compiler-known | needs **per-type synthesis** | twice | yes |
| Runtime-backed | needs mutation or an opaque C representation | twice | yes |
| Prelude | expressible in Menard | **once** | listed only |
| Host seam (§2.15) | touches the OS | twice | yes |

Governing principle: **whatever is implemented twice belongs in the spec.**

**The result is that the compiler-known set collapsed to four operations** —
`show`, `print`, `=`, `compare` — because they are exactly the ones the derive
engine must synthesize. (v0.5.3 corrected the count to five.)

### The `!` convention: convention, not effect system (ADR 30)

Enforcement would be **propagation**, and propagation is an effect system — which
§1.3 excludes. It dies on higher-order code: *what is `map`'s effect when its
argument performs I/O?* So: a convention with a defined meaning, appearing in no
type, propagating nowhere, enforced by a linter.

**v0.5.6 rewrote this ADR.** The convention survives, but narrowed to observable
mutation — and the "names the §2.11.B boundary" justification, which was the
whole reason it was extended to I/O in the first place, is withdrawn: the
boundary is now marked by the confinement of `extern`.

**Mechanical catch from the same revision.** `(extern mn_sb_append! …)` cannot
work: in `extern` **the name *is* the C symbol**, and `!` is illegal in C
identifiers. Externs keep C-legal names; any `!` lives on the Menard wrapper —
needed anyway for `Result` mapping and `EINTR` retry.

### The collector was wrong in v0.5, in two places (§2.2.1, ADR 9/24)

v0.5 asserted "odd means immediate, even means pointer" as the collector's
decision rule. **That is false**, because two kinds of even word can sit in a heap
slot without being heap pointers: a closure's **code pointer** (§2.6), and an
interned **symbol** (§2.2). Neither can be fixed by a field map, which type
parameters made impossible. The fix is a **shape kind** — `ordinary`, `closure`,
`bytes`, `immortal` — a fixed property of a built-in shape, not of a type
argument, so the no-monomorphization argument survives.

Recorded as a general lesson: **the tag bit is necessary but not sufficient.**
(v0.5.4 came back to the same sentence a third time, and restated the rule so the
empty word is the third case rather than a special kind of pointer. The
static-objects entry came back a fourth, with the f64 payload.)

### Bytes, chars, and the seam

**No `Byte` type; `Char` is a scalar value; `Str` is arbitrary bytes** (§2.3,
ADR 32). `Char` as v0.5 defined it cannot be a byte, and a `Byte` type is a
second integer type, which ADR 3 rejects for `Int32` on three grounds that
transfer exactly. Note where the cost lands: representation-free,
surface-expensive.

**The host seam (§2.15), and §2.11.B.** Tier 0 floor (argv, read/write file,
stdout/stderr, exit), Tier 1 utility, Tier 2 v2. `IoError` is a closed Menard
variant with codes and **never `strerror`**. Six rules, of which the first is a
genuine v0.5 defect: **`print` shows, `write` emits** — `print` derives through
`show`, which quotes a `Str`, so the emitter could not have written IR through
it. (Spelt `print!`/`write!` at the time.)

**§2.11.B (Boundary)**: ambient state may *enter* a program but may never *reach*
emitted bytes except through an argument the fixed point also supplies.

**A new cost centre, named**: §2.8.2 and §2.15 are implemented **twice** — C
runtime and interpreter must agree exactly.

---

## 2026-09-25 — v0.5 ratified

### Ratified: type parameters on user nominal types (§2.3, ADR 23)

```lisp
(defrec (Pair [a b]) (fst: a) (snd: b))
(variant (Tree [a]) (Leaf a) (Node (Tree a) (Tree a)) (Empty))
```

**The catch, and why it decided the collector.** Polymorphic bodies compile once
only if the code knows nothing about its type arguments — but the shape
descriptor carried a GC field map, and that depends on the instantiation.

| Option | Cost | Verdict |
|---|---|---|
| Monomorphize per instantiation | ~400 lines, duplication, compile-time growth | **Rejected** |
| Pass type dictionaries as hidden arguments | An ABI change reaching into closures | **Rejected** |
| **Decide pointer-vs-immediate by tag bit at collection time** | Invariants become load-bearing | **Accepted** |

**Consequences accepted:** §2.2's invariants cease to be conventional; "no
unboxed fields" and "no general mutable arrays" move from preference to non-goal;
the allocator must zero bodies and the collector skip the empty word. **v0.5.1
then found that tagging alone is insufficient** and added shape kinds — and the
static-objects entry split those into a layout kind and a location bit.

**The fences:** declared never inferred; types not type constructors; no type
classes; no subtyping or row polymorphism; aliases nullary.

### Ratified: no Hindley–Milner inference (§2.3, ADR 21)

All representation work is genuinely free, but two moving parts disqualify it:
the **value restriction** (`Ref` + let-generalization is unsound, so
`(let r (ref (list)))` would generalise to `∀a. (Ref (List a))`), and
**diagnostics** (unification failures reported far from the cause). Explicit
parameters are **additive** with later inference, which decides it.

### Ratified: aliases, and two views of every type (§2.3, ADR 25)

Operator's argument, correcting an error in the previous entry: alias names
should be retained for error messages, because flattening them makes diagnostics
"very very detailed". Accepted, reversing the earlier claim that aliases need no
export. Canonical view (expanded, everything emitted) versus display view (alias
names, diagnostics only). Diagnostics remain outside the fixed point but must
still be deterministic, because §3.7 byte-compares messages. A `pub alias` is the
module's **vocabulary**.

### Ratified: casing is enforced (§2.1, ADR 26)

Upper for types and constructors; lower for values, functions, fields and type
variables. Checked in parser and typer, not the lexer — `Foo` could be either,
and only the surrounding form knows.

### Ratified: private by default, `pub` to export (§2.7, ADR 27)

Rejected automatic export of every declaration. **Derived functions are always
internal and always linkable**; a `pub` signature may not mention a private
nominal type. (`extern` was added to the non-exportable list in v0.5.1, and
confined to the seam modules in v0.5.6 — which is what gives ADR 27's second
half something to enforce.)

### Node: "union types" clarified

The operator meant **variant types**, not untagged structural unions. Variants
already exist; structural unions remain out (§1.3).

---

## 2026-09-25 — name check closed; v0.4 written

### Name check: **closed, clean**

Verified by the operator (Graeme, 2026-09-25). The sources searched were not
itemised in the report, so the checklist below stands as the list of places the
name would matter, not as a per-source audit trail.

- esolangs.org wiki
- Wikipedia's list of programming languages, and TIOBE
- Rosetta Code language index
- a plain web search for `"Menard" programming language`
- crates.io, npm, PyPI — matters only if host tooling is ever published

The presentation rule stands: always introduce the name with Borges attached,
because "Menard" alone is a French surname, a county in Illinois (named for
Pierre Menard, its first lieutenant governor), a town in Texas, and one letter
from a US hardware chain.

### v0.4: renamed, and the adversarial review incorporated

| # | Finding | Disposition |
|---|---|---|
| 1 | The gate proves *determinism*, not *correctness*; §2.11 covered one of four obligations | **Accepted, structural.** §2.11 (four obligations) and §2.14 added. |
| 2 | Address-bearing values can reach emission; "not orderable" ≠ "not showable" | **Accepted.** §2.12: separate positive predicates. |
| 3 | `Sym` ordering unspecified | **Accepted.** Byte-wise on the *name*, never the address. |
| 4 | Equality/order *consistency* under normalisation | **Accepted; my own concern withdrawn** — for well-formed UTF-8, byte order *is* code-point order. |
| 5 | Orderable is *recursive*; nested map keys need a content-derived order | **Accepted.** §2.12 recursive; §2.11.O: ordered by sorted entries. |
| 6 | Tagged multiply needs wide intermediates | **Accepted in substance, rejected in mechanism.** `Int` is `Z/2^63`, so only the product *mod 2^63* is needed, which fits in 64 bits. ADR 19, with the warning that a naive tagged multiply is wrong *and deterministic*, hence invisible to the gate. |
| 7 | `asIntN(63, …)` applies to *untagged* values only | **Accepted.** §2.2, §3.9.2. |
| 8 | "No perf argument for `Int32`" is true of the backend, false of the TS host | **Accepted.** Iteration-speed cost, not correctness. |
| 9 | 63-bit leakage into spans/lengths: non-issues | **Accepted as knocked down.** Seeds fixed to constants anyway. |
| 10 | Instantiating polymorphic built-ins implies real monomorphization machinery | **Accepted at the time — superseded in v0.5.** The derive-engine half stands. |
| 11 | "Paid once" is backwards | **Accepted.** §2.9 rewritten as a trade paid per idiom. |
| 12 | "Small enough for one person" understates total work | **Accepted.** §7 revised; hidden cost named as two behaviourally identical compilers. |

**Vera's verdict on §2.11 vs. call-site predicates** — she confirms the design:
predicates relocate the discipline rather than removing it. §2.14 carries that
argument.

### Ratified: the language is called **Menard**; source files use `.mnd`

After Borges' *Pierre Menard, Author of the Quixote*, in which an author
independently writes a text word-for-word identical to Cervantes' — not a copy,
but a separate act of authorship arriving at the same bytes. The name leads on
the **identical copy** half of the design rather than the **self** half: the self
is already carried by the bootstrap chain, and the comparison is the stranger
claim.

**Extension: `.mnd`** — the consonant skeleton, matching the three-letter
convention. Rejected `.men`, which reads as an ordinary English word.

**Rejected alternatives** (recorded so the reasoning is not re-litigated):

| Name | Source | Why not |
|---|---|---|
| Quine | W.V.O. Quine; a quine is self-reproducing | Exact, but Quine gave us *quasi-quotation*, a self-referential mechanism — and this language bans macros. Naming it after the man who contributed the thing it forbids is a hostage to fortune. |
| Raspe | Baron Munchausen, who bootstrapped himself out of a swamp | Ties to `make bootstrap`, but nobody would guess it. *Munchausen* itself rejected for the syndrome collision. |
| Ouroboros | The snake eating its tail; Eddison's *The Worm Ouroboros* | The right image, but not a person, and long to type. Better as a diagram. |
| Neumann | von Neumann — self-reproducing automata | The deepest theoretical fit, and the least distinctive name. |

### Ratified: `Int` stays 63-bit; one integer type (§2.2, ADR 3)

- **Rejected 32-bit `Int`:** not faster — in the tagged representation `add` is
  one instruction at any width.
- **Rejected `Int32` + `Int64`:** conversion noise, duplicated arithmetic paths,
  and a *second axis* on which stage0 and the backend can disagree.
- **Standing escape hatch:** if 63 bits ever proves wrong, make `Int` 32-bit
  outright, not add a second type.
- **v0.5.1 note:** this argument is what refuses a `Byte` type, and the tag bit
  turned out to need shape kinds beside it.
- **Static-objects note:** ADR 4's "boxed `Float`" turned out to need the `bytes`
  layout, for the same reason — the representation table is a place where each
  entry must say what the collector should *not* look at.

### Ratified: no macros, ever (§2.9, ADR 7)

Permanent, not deferred. The special-form list in §2.5 is the whole language.

### Ratified: determinism derives from the type, not the container (§2.11, ADRs 8, 16)

No caller-supplied ordering predicate in output paths. Consequence: `Map` is free
to be any implementation internally — and in v0.5.1 that freedom deleted the hash
function from the agreement surface entirely.

### Ratified: stage0 and the oracle are TypeScript on Bun (§3.9, ADRs 13, 15)

Host integers model **63-bit** wrapping (`BigInt.asIntN(63, …)`), not 64-bit, and
model `Int` **untagged** — the tag is backend-only.

---

## Resolved by the v0.4 review

The five candidate holes raised from re-reading v0.3, kept for provenance:

1. `Sym` ordering → fixed: byte-wise on the name (§2.12).
2. `Str` ordering → my framing was wrong; the real issue is equality/order
   consistency, fixed by banning normalisation (§2.3).
3. Orderable defined only by exclusion → fixed: the predicates are positive and
   recursive (§2.12).
4. "Output the fixed point depends on" was an unenforceable convention → fixed:
   showability is a type-level check, and debug printing is isolated (§2.12,
   and properly defined in §2.16 as of v0.5.3).
5. Polymorphic built-ins in a generics-free language → the premise no longer
   applies (§2.8).
