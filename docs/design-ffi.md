# Design: foreign FFI, packages, and the native link

**Status:** draft — capture of post–Build B discussion. Iterate after the
concurrency track (see [design-libraries-concurrency.md](design-libraries-concurrency.md))
has landed enough that driver/`build` changes are not competing with Phase 4–9.

Does not amend [menard-spec.md](menard-spec.md) until ratified into
[decisions.md](decisions.md) and the specification.

### Relationship to other docs

| Document | Role |
|---|---|
| [design-libraries-concurrency.md](design-libraries-concurrency.md) | Purpose, Platform API stack, concurrency; Phase 3 = “FFI proving ground” |
| [buildout-libraries-concurrency.md](buildout-libraries-concurrency.md) | Build B (SQLite) — shipped proving ground |
| [runtime-abi.md](runtime-abi.md) | Catalogue of `mn_*` only |
| [decisions.md](decisions.md) | Ratified ADRs (`/ffi/` confinement; SQLite proving ground) |
| **This document** | How foreign libs are authored, discovered, linked by `./mn`, and shipped as packages |

**Two initiatives (do not couple them):**

1. **Concurrency track** — finish first (or far enough that `mn build` is stable).
2. **FFI link + package delivery** — this design; implement when (1) is not the bottleneck.

```
Runtime ABI ≠ Platform API ≠ foreign FFI ABI
        │
   emit declares externs          (done — Build B)
        │
   build links bridges            (gap — this design)
        │
   packages ship .mnd + C + manifest
```

---

## 1. Why this document exists

### 1.1 What Build B proved

Menard can call a real foreign C library through an explicit conversion layer:

- Modules under `/ffi/` (not `stdlib/`) may declare non-`mn_*` `extern`.
- Seam modules stay `mn_*`-only.
- Emit opens LLVM `declare` for those symbols (`collect-ffi-imps`).
- A thin bridge converts `MnWord` ↔ C (`sql_ffi.c` + `sql_bridge.c` → libsqlite3).
- SQLite lives under [`examples/ffi/sqlite/`](../examples/ffi/sqlite/); `./mn` itself
  does **not** link libsqlite3.

That is enough to close Build B’s “one foreign library” criterion.

### 1.2 What Build B did not solve

| Gap | Today |
|---|---|
| Who links the bridge? | Makefile `sqlite-native`, not `./mn build` |
| Can an app outside this repo use it? | Only by copying Make recipes |
| How does `github:…` deliver C? | Unspecified |
| Product OS integrations (Reminders, …) | Wrong hammer for in-process FFI |

An overnight review concluded: **emit already understands foreign symbols;
`build`/`run` do not understand foreign objects.** Closing that gap is the next
FFI epoch — after concurrency pressure eases.

### 1.3 EventKit Reminders (negative result)

An earlier proving ground used macOS Reminders via EventKit. It exercised the
same `/ffi/` + emit path but failed as a *sustainable* example:

- TCC is per **client identity**, not per terminal; Ghostty’s grant ≠ the binary’s.
- A bare CLI often never shows the permission dialog (needs AppKit / run loop).
- EventKit predicates have sharp edges (e.g. incomplete + nil dates).
- A dedicated `.app` binary and ad-hoc codesign are product packaging, not language proof.
- Symptom collapse: TCC, empty store, wrong predicate, and JSON handoff bugs all
  looked like `(0 results)`.

**Decision:** SQLite is the proving ground. For Reminders (and similar), prefer an
**external helper CLI** (e.g. [remindctl](https://github.com/openclaw/remindctl))
invoked via `std/proc`, not in-process EventKit inside Menard.

Lesson for this design: **choose foreign libs that do not fight the OS identity
model.** FFI should prove conversion + linking, not reinvent platform apps.

---

## 2. Governing slogans

> **Runtime ABI ≠ foreign C FFI ABI.**  
> Apps and `stdlib/` never treat `mn_*` as “call any C.”

> **Menard is the default; native must justify its existence.**  
> Same slogan as the libraries design. Foreign C is justified when the capability
> cannot live in Menard (or is a measured hot path with an explicit bridge).

> **`./mn` is the driver, not a kitchen sink.**  
> The driver binary stays free of optional foreign libs. App binaries link only
> what their import graph needs.

> **Packages ship their bridges.**  
> Importing a Menard module must be enough for `./mn build` to find and link any
> colocated native sources — whether the tree is in-repo or under `~/.menard/deps`.

---

## 3. Layering

```
APPLICATIONS
      │  import github:acme/sqlite@1.0.0/sqlite
MENARD LIBRARIES (may include /ffi/ modules + native/)
      │
STANDARD LIBRARY          std/*     ← Platform API (mn_* only at the seam)
      │
MENARD NAMESPACE
      │
C RUNTIME                 mn_*      ← Runtime ABI
      │
FOREIGN BRIDGES           sql_*, …  ← linked into *app* binaries only
      │
SYSTEM / VENDORED LIBS    libsqlite3, …
```

| Layer | May declare `extern` | Linked into |
|---|---|---|
| Seam (`std/sys`, `io`, `fs`, `proc`, `time`) | `mn_*` only | Every native program (via runtime sources) |
| `/ffi/` modules (path contains `/ffi/`, not under `stdlib/`) | non-`mn_*` only | Only programs that import them |
| Everywhere else | none | — |

Conversions that touch tagged words live **only** in a small C file next to the
bridge (`*_ffi.c`), never in Menard source or in `stdlib/`.

---

## 4. Bridge shape (standing pattern)

Proven with SQLite; reuse for future foreign libs.

| Piece | Role |
|---|---|
| `*_bridge.h` / `*_bridge.c` | Pure C ABI; no `MnWord`; owns the foreign library |
| `*_ffi.c` | `MnWord` ↔ C; copy into `Str`; free C buffers in the bridge |
| `*.mnd` under `/ffi/` | `extern` + Menard API (`Result`, JSON decode, …) |
| Interchange | Prefer `Str` (often JSON) over inventing new Menard scalar types |

**No new Menard numeric / byte types for FFI** unless a separate language ADR
says otherwise. Wide C integers: truncate-with-check, `Result` error, or
multi-word blob as `Str`/bytes — in the bridge.

**Ownership:** copy into Menard `Str`; foreign buffers are freed before return
(or never escape). Do not alias the Menard heap into C long-term without a
rooted story.

**Callbacks C→Menard:** out of scope until the single-mutator / suspension story
(Builds C/D in the concurrency design). Foreign threads must not run Menard
heap code.

**Interpreter:** foreign symbols stay **unbound** (hard error). Dual-host
agreement is not claimed for FFI modules.

---

## 5. What `./mn` does today vs target

### 5.1 Today

| Command | Foreign `extern` | Bridge `.c` / `-l` |
|---|---|---|
| `emit` | Declares LLVM prototypes | No |
| `build` / `run` | Same emit | Fixed `clang-argv`: bitcode + runtime `.c` + `-lm` only |
| Make `sqlite-native` | — | Manually adds bridge sources + `-lsqlite3` |

### 5.2 Target

```
./mn build app.mnd -o build/app
```

1. Resolve the import graph (`./`, `std/`, `github:…` → directories).
2. Emit bitcode (unchanged: declare foreign symbols).
3. **Collect link inputs** from every imported module that publishes a
   **native manifest** (see §6).
4. Spawn `cc` with runtime sources **plus** those objects/libs.
5. Write the app binary.

`./mn` the driver still links only the runtime. Optional foreign code appears
only in **downstream** binaries.

### 5.3 Incremental delivery (suggested)

| Step | Deliverable |
|---|---|
| A | CLI flags: `--cc-src`, `--lib`, `--I` (unblocks without manifests) |
| B | Colocated `native.json` + import-graph collection for local `./` imports |
| C | Same collection for `github:…` once deps resolve to `~/.menard/deps/…` |
| D | Retire Make `sqlite-native` as the primary path (keep as smoke alias optional) |

Do not start at D. A→B already makes in-tree SQLite feel like a normal `mn build`.

---

## 6. Native manifest

### 6.1 Location

Colocated with the Menard module that declares the foreign `extern`s (or with
the package root of that module). Discovery key = **resolved directory of the
imported module**, not the app’s cwd and not “menard-lang’s Makefile.”

Example (in-tree or in deps cache):

```
…/sqlite/
  sqlite.mnd
  native.json          ← link contract
  bridge/
    sql_bridge.c
    sql_ffi.c
    sql_bridge.h
```

### 6.2 Sketch (format open; JSON is fine for v1)

```json
{
  "c": ["bridge/sql_bridge.c", "bridge/sql_ffi.c"],
  "include": ["bridge"],
  "libs": ["sqlite3"],
  "pkg-config": ["sqlite3"]
}
```

Paths are relative to the directory that contains the manifest. Absolute paths
are forbidden in published packages.

`pkg-config` is best-effort: if missing, fall back to `-l` from `libs` (as the
Makefile does today).

### 6.3 Collection rules

- Walk the **entire** import graph used for emit.
- For each module dir with a manifest, append its `c` / `include` / `libs`
  (dedupe by resolved absolute path / flag string).
- Pure Menard packages simply omit the manifest — zero cost.
- Cycles remain forbidden (existing module rule).

### 6.4 What the manifest is not

- Not a second Runtime ABI.
- Not permission for `stdlib/` to declare non-`mn_*`.
- Not dynamic loading / plugin ABI (v1 is **static link** of listed `.c` and
  system/vendored libs).

---

## 7. External packages (`github:…`)

### 7.1 The requirement

> Importing a `.mnd` file from a package must pull its C into the app link
> automatically via `./mn build` — without forking menard-lang or copying Make.

That only works if **the package tree includes the bridge and the manifest**.

### 7.2 Layout in the deps cache

Spec already maps:

```
import github:owner/repo@version/module
  →  ~/.menard/deps/owner/repo/version/module.mnd
```

(or `MENARD_DEPS`). FFI packages use the same locator; native files sit beside
the module:

```
~/.menard/deps/acme/sqlite/1.0.0/
  sqlite.mnd
  native.json
  bridge/…
```

App:

```
import github:acme/sqlite@1.0.0/sqlite as Sql
```

`./mn build` resolves → reads `native.json` from that directory → links.

### 7.3 In-tree vs package — one mechanism

| | Proving ground today | Published package |
|---|---|---|
| Import | `import "./sqlite.mnd"` | `import github:acme/sqlite@1.0.0/sqlite` |
| On disk | `examples/ffi/sqlite/…` | `~/.menard/deps/…/…` |
| Discovery | dir of imported module + `native.json` | **same** |

No second linker path for “local only.”

### 7.4 Integrity and versioning

- C sources and `native.json` are part of the **versioned package artifact**.
- Changing the bridge ⇒ bump the package version (same as changing `.mnd` API).
- Lockfile / content hashes remain an open libraries-design item; when they
  land, they cover native files too — not a separate FFI hash scheme.

### 7.5 System libraries vs vendored objects

| Strategy | When |
|---|---|
| `-l` / pkg-config (e.g. sqlite3) | Ubiquitous system libs |
| Ship static `.a` / `.o` in the package + list in manifest | Reproducible / exotic toolchains |

v1 bias: system libs for the proving ground; vendoring is allowed by the
manifest shape but not required for Build B.

---

## 8. Product integrations vs FFI proofs

| Need | Prefer |
|---|---|
| Prove Menard↔C conversion + `/ffi/` + emit/link | In-process bridge (SQLite pattern) |
| Talk to a platform app with its own TCC/identity | **Out-of-process** helper (`std/proc` + CLI/API) |
| Optional capability in every Menard install | Platform API / `mn_*` (libraries design), not a random foreign lib in `./mn` |

Dynamic libraries (dylib/DLL) loaded into `./mn` **do not** fix OS privacy
identity; the loading process is still the TCC client. Prefer static link of
bridge sources into the **app** binary, or a separate helper process.

---

## 9. Explicit non-goals (this design epoch)

- Baking SQLite (or any optional foreign lib) into the `./mn` driver binary
- General package manager / registry / lockfile (libraries design owns delivery)
- Full C type system mapping / libffi reflection
- New Menard integer/float/byte widths “for FFI”
- C→Menard callbacks on foreign threads
- In-process EventKit / similar TCC-heavy frameworks as language examples
- Interpreter agreement for foreign symbols
- Plugin / hot-reload dylib ABI

---

## 10. Open questions (answer in implementation / ADR)

1. **Manifest format:** JSON file vs a Menard declaration form vs both?
2. **Who may publish a manifest?** Only modules under `/ffi/`, or any package
   path that opts in?
3. **Compile caching:** rebuild bridge `.o` when inputs change; where do objects
   live (`build/ffi-cache/…`)?
4. **Windows / MSVC:** same manifest; different `cc` argv — how much does
   `clang-argv` abstract?
5. **Failure UX:** missing pkg-config / missing `.c` — diagnostics that name the
   importing module and manifest path.
6. **Multiple connections / handles:** SQLite proving ground uses a process-global
   DB; package APIs may need opaque `Int` handles later — policy for lifetimes?

---

## 11. Implementation sequence (FFI track)

Defer start until concurrency work is not contending for `src/mn.mnd` / emit.

| Phase | Objective | Depends on |
|---|---|---|
| F0 | This document reviewed; no silent drift from Build B ADRs | — |
| F1 | `mn build` accepts extra link inputs (flags) | Stable `clang-argv` |
| F2 | `native.json` + collect from local import graph; sqlite demo via `mn build` | F1 |
| F3 | Collection from `github:` resolved dirs | F2 + deps fetch as today |
| F4 | Document package author guide; optional Make alias only | F3 |
| F5 | (Later) callbacks / richer types only if concurrency + ADR allow | C/D |

Build B remains **done** with Make; F1–F4 are the productization of the same
architecture.

---

## 12. Success criteria

When this design is implemented and ratified:

- [ ] `./mn build` on a program that imports an FFI module links its bridge
      without a hand-written Make recipe.
- [ ] The same flow works for a module resolved under `~/.menard/deps/…`.
- [ ] `./mn` does not link optional foreign libs into the driver.
- [ ] `stdlib/` still cannot declare non-`mn_*` `extern`.
- [ ] SQLite (or successor) remains outside `stdlib/` unless a separate product
      decision says otherwise.
- [ ] Docs state clearly: platform-app integrations → helper process; FFI →
      conversion proof + packaged bridges.

---

## 13. Summary

Build B proved **conversion and confinement**. The remaining FFI design is
**delivery and linking**:

1. Manifest beside the module that owns the `extern`s.  
2. `./mn build` follows the import graph to resolved directories and extends
   `clang-argv`.  
3. Packages are just trees in the deps cache with the same layout.  
4. Keep foreign libs out of the driver; keep TCC-heavy OS apps out of the
   proving ground.

Iterate this document after concurrency; implement when the driver is ready to
grow link planning without blocking Phase 4–9.
