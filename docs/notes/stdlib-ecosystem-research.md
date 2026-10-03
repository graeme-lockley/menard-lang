# Standard libraries and external libraries in five ecosystems

Research note. Each claim is tied to a primary page. Pages were fetched on 3 October 2026. This note records what those pages say. It does not propose a design.

Citation form: a claim, then the page that states it.

## Which Kestrel

The brief asked for “Kestrel’s approach (with external imports using https://…)”. Four projects use the name. None of them uses an `https://` URL as a module import specifier.

| Candidate | What it is | Why it is or is not the match |
| --- | --- | --- |
| [kestrel-lang.com](https://kestrel-lang.com/), repo [kestrellang/kestrel](https://github.com/kestrellang/kestrel) | A compiled language with a standard library and a package manager named Flock | This is the one with a library layer (prelude, `std.*`, external packages, lockfile, cache). Import paths are dotted identifiers, not URLs. Packages are downloaded over HTTPS from a registry. |
| [opencybersecurityalliance/kestrel-lang](https://github.com/opencybersecurityalliance/kestrel-lang) | A threat-hunting language | `https://` is a data-source URI in `GET … FROM`, not a code import. Documented schemes for the STIX-bundle interface are `file`, `http`, and `https` ([interface source](https://kestrel.readthedocs.io/en/latest/_modules/kestrel_datasource_stixbundle/interface.html)). |
| [ascandone/kestrel-lang](https://github.com/ascandone/kestrel-lang) | A functional language that compiles to JavaScript | The README shows local modules and `npm install -g kestrel-lang`. No URL-import syntax is documented there. |
| [EricLBuehler/Kestrel-Programming-Language](https://github.com/EricLBuehler/Kestrel-Programming-Language) | An older LLVM compiler for `.ke` files | The README points at in-repo docs and does not describe URL imports. |

The rest of the Kestrel section is about kestrel-lang.com, because it is the only candidate with a standard library and external libraries. The `https://` in the brief matches how Flock downloads archives, and how the threat-hunting language names data sources. It does not match a source-level import.

The language reference in the compiler repo gives the module-path grammar as identifiers separated by dots, not URLs ([docs/language/modules.md](https://github.com/kestrellang/kestrel/blob/main/docs/language/modules.md)). The parser stores a module path as identifier tokens ([module/path.rs](https://github.com/kestrellang/kestrel/blob/main/lib/kestrel-parser/src/module/path.rs)).

## Deno

### What is always available with zero import

The global `Deno` namespace holds non-web APIs: files, TCP sockets, HTTP serving, subprocesses, FFI ([Deno namespace](https://docs.deno.com/api/deno/)). Web platform APIs (`fetch`, streams, workers, crypto, and the rest of that index) are implemented by the runtime and are not imported ([Web APIs](https://docs.deno.com/api/web/)). Node compatibility modules are not globals; they are imported with the `node:` scheme ([API reference](https://docs.deno.com/api/)).

The standard library is not built in. It is imported.

### What the standard library is, and how it is grouped

`@std` is a set of packages on JSR. Each package is versioned on its own. The docs describe them as audited, with no third-party dependencies ([Deno Standard Library](https://docs.deno.com/runtime/reference/std/)).

The index is a flat list, not four buckets. Mapping that list by the descriptions on the same page:

- Data and formats: `@std/collections`, `@std/bytes`, `@std/data-structures`, `@std/encoding`, `@std/csv`, `@std/json`, `@std/yaml`, `@std/toml`, `@std/front-matter`, and others.
- System and network: `@std/fs`, `@std/path`, `@std/io`, `@std/net`, `@std/http`.
- Test: `@std/assert`, `@std/expect`, `@std/testing`.
- Command-line and application helpers: `@std/cli`, `@std/fmt`, `@std/log`.

Most packages are stable and use semantic versioning. The same page marks some as unstable (`@std/cache`, `@std/datetime`, `@std/log`, and others) or internal (`@std/internal`, “do not use this directly”).

### How external libraries live

Three mechanisms, all usable from an `import`:

- `jsr:` specifiers, which the modules page recommends, including for `@std` ([Modules](https://docs.deno.com/runtime/fundamentals/modules/)).
- `npm:` specifiers ([same page](https://docs.deno.com/runtime/fundamentals/modules/)).
- `https:` URLs, inline or rewritten by an import map. The dependency guide says registries are recommended for applications, because HTTPS imports can drift to different versions across files, are not managed by `deno add` / `deno install`, and trust the serving host ([Dependency management](https://docs.deno.com/runtime/packages/)).

`deno.land/x` is described as the legacy registry for HTTPS imports. New packages are directed to JSR ([Publishing packages](https://docs.deno.com/runtime/packages/publishing/)).

Downloaded dependencies go in a global cache, `DENO_DIR`, shared across projects. Defaults are `$HOME/.cache/deno` on Linux, `$HOME/Library/Caches/deno` on macOS, and `%LOCALAPPDATA%\deno` on Windows ([Installation](https://docs.deno.com/runtime/getting_started/installation/)). `deno info` prints the remote-modules cache under that directory ([deno info](https://docs.deno.com/runtime/reference/cli/info/)).

### Is a project config file required for std plus one external library?

No. A one-off script can import `jsr:@std/path` directly, without `deno add` ([Standard Library](https://docs.deno.com/runtime/reference/std/)). Third-party examples on the modules page use versioned `jsr:` and `npm:` specifiers in the source. The Deno 2 retrospective says the import map is optional so that scripts can stay single-file, without `deno.json` ([What we got wrong about HTTP imports](https://deno.com/blog/http-imports)).

`deno add` is the path that writes a config: if no config exists, it creates a `deno.json` import map ([Introducing your new JavaScript package manager](https://deno.com/blog/your-new-js-package-manager)). The `imports` field in `deno.json` is an import map that remaps a bare specifier to a URL or registry specifier ([deno.json](https://docs.deno.com/runtime/reference/deno_json/), [Modules](https://docs.deno.com/runtime/fundamentals/modules/)).

### How versions are pinned

A specifier can carry a version: `jsr:@luca/cases@1.0.0`, `npm:cowsay@1.6.0` ([Modules](https://docs.deno.com/runtime/fundamentals/modules/)). An import map typically stores a range, such as `jsr:@std/async@^1.0.0` ([same page](https://docs.deno.com/runtime/fundamentals/modules/)).

When a `deno.json` or `package.json` is present, Deno writes `deno.lock`, mapping each range to one resolved version plus an integrity hash ([Lock dependencies](https://docs.deno.com/examples/dependency_lockfile_tutorial/)). `deno ci` installs from that file and errors if it is missing or stale ([Dependency management](https://docs.deno.com/runtime/packages/)).

HTTPS imports pin by the URL text itself. The retrospective says a URL locks one exact version until someone edits it, and that a project can end up with several variants of the same library ([HTTP imports](https://deno.com/blog/http-imports)).

### Layering problems they hit

HTTP imports were the whole module system, including `https://deno.land/std@0.224.0/assert/mod.ts`. The same post lists the costs: long URLs, a `deps.ts` re-export convention that was cumbersome next to a manifest, no semantic versioning so duplicates were easy, and availability tied to the least reliable host. JSR is described as still resolving to an HTTPS URL (`jsr:@luca/flag` as a redirect to `https://jsr.io/@luca/flag/1.0.0/mod.ts`) while keeping semver and a single host. HTTP imports were not removed.

The standard library moved. New features go to `jsr.io/@std`. `deno.land/std` stays up for existing programs and receives critical updates such as security patches ([The Deno Standard Library is now available on JSR](https://deno.com/blog/std-on-jsr)). Stabilization was per package, not one version for all of std ([The stabilization process of the Standard Library has begun](https://deno.com/blog/stabilize-std)).

There is also a second copy of platform APIs. File, path, and HTTP utilities exist as `@std` packages ([std index](https://docs.deno.com/runtime/reference/std/)), as `node:` modules ([API reference](https://docs.deno.com/api/)), and, for many I/O operations, as the global `Deno` namespace ([Deno namespace](https://docs.deno.com/api/deno/)).

Permissions are separate from the module graph. By default a program cannot read files, use the network, read the environment, or spawn processes ([Security](https://docs.deno.com/runtime/fundamentals/security/)). The initial static module graph, including `https:` and `jsr:` imports whose specifier is a string literal, loads without `--allow-net` or `--allow-read`. That exemption is only for loading. Runtime I/O still needs a grant, and a dynamic `import()` with a computed specifier is checked.

## Bun

### What is always available with zero import

The `Bun` global, Web globals (`fetch`, `Blob`, `URL`, timers), and a set of Node globals (`Buffer`, `process`, `__dirname`, `require`, and others) are listed as globals ([Globals](https://bun.sh/docs/runtime/globals)). `Bun.serve`, `Bun.file`, `Bun.write`, `Bun.spawn`, and many others are methods on that global ([Bun APIs](https://bun.sh/docs/runtime/bun-apis)).

Some Bun APIs are modules, not globals: `bun:sqlite`, `bun:ffi`, `bun:test` ([same page](https://bun.sh/docs/runtime/bun-apis)). The SQLite page says to import the built-in `bun:sqlite` module, and the sample is a single `db.ts` file:

```ts
import { Database } from "bun:sqlite";
```

([SQLite](https://bun.sh/docs/runtime/sqlite)). That page does not mention `package.json`.

### What the standard library is, and how it is grouped

Bun does not publish a separate `@std`-style package index. The documented standard surface is the `Bun` global plus `bun:*` modules, alongside Web APIs and Node built-ins.

From the Bun APIs table: HTTP server (`Bun.serve`), file I/O (`Bun.file`, `Bun.write`), child processes, sockets, SQLite (`bun:sqlite`), FFI (`bun:ffi`), testing (`bun:test`), shell (`$`). The page calls these the canonical Bun-native APIs, and says Bun implements Web APIs where a standard exists and adds APIs where none does (file I/O, starting an HTTP server).

Node built-ins are a second library, imported as `node:*`. The compatibility page tracks them against Node.js v26 and says that if a package works in Node and fails in Bun, that is treated as a Bun bug ([Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)).

### How external libraries live

`bun install` and `bun add` are a Node-compatible package manager. `bun install` installs `dependencies`, `devDependencies`, and `optionalDependencies` from a project that has a `package.json`, and writes `bun.lock` ([bun install](https://bun.sh/docs/pm/cli/install)).

`bun add` writes the package into `package.json`. Specifiers can be a registry package, a git URL (`git+https`, `git+ssh`, `github:`), or an HTTPS tarball. The tarball example uses `https://registry.npmjs.org/zod/-/zod-3.21.4.tgz`. `--registry` overrides `.npmrc`, `bunfig.toml`, and environment variables ([bun add](https://bun.sh/docs/pm/cli/add)).

Bare specifiers resolve with Node’s algorithm from `node_modules`, using `package.json` `"exports"` ([Module resolution](https://bun.sh/docs/runtime/module-resolution)).

Lifecycle scripts of dependencies do not run unless the package is listed in `trustedDependencies` ([bun install](https://bun.sh/docs/pm/cli/install)).

### Is a project config file required for std plus one external library?

The documented `bun:` and `Bun.` examples do not include a config file. The SQLite sample is one file importing `bun:sqlite` ([SQLite](https://bun.sh/docs/runtime/sqlite)).

An external package, as documented, goes through `bun add` / `bun install`, which write `package.json` and `bun.lock` ([bun add](https://bun.sh/docs/pm/cli/add), [bun install](https://bun.sh/docs/pm/cli/install)). `bun add --global` is the exception that does not modify the current project’s `package.json`; it is for command-line tools, not for importing a library into a program.

I did not find a Bun docs sentence that says “`package.json` is optional for `bun:` builtins.” The evidence is the shape of the examples, not an explicit waiver.

### How versions are pinned

`bun add zod@3.20.0` pins a version; `zod@^3.0.0` writes a range. `--exact` writes the resolved version with no range ([bun add](https://bun.sh/docs/pm/cli/add)). `bun install` writes `bun.lock` ([bun install](https://bun.sh/docs/pm/cli/install)).

### Layering problems they document

Two surfaces cover the same jobs. File I/O, HTTP, and tests exist as Bun APIs (`Bun.file`, `Bun.serve`, `bun:test`) and as Node compatibility (`node:fs`, `node:http`, and the rest of the compatibility matrix) ([Bun APIs](https://bun.sh/docs/runtime/bun-apis), [Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)). The compatibility page is explicit that Node compatibility is incomplete module by module (some `node:*` entries are partial).

The runtime docs also describe Bun as aiming to be a drop-in for Node globals (`process`, `Buffer`) and modules (`path`, `fs`, `http`), and as an ongoing effort ([Bun docs introduction](https://bun.sh/docs)).

## Haskell

### What is always available with zero import

The `Prelude` module is imported by default into every module, unless the file imports `Prelude` explicitly or `NoImplicitPrelude` is on ([Prelude](https://downloads.haskell.org/ghc/latest/docs/libraries/base-4.22.0.0-66f8/Prelude.html)). The GHC user guide says the same, and says `RebindableSyntax` implies `NoImplicitPrelude`. A module named `Prelude` in `Prelude.hs` replaces the implicit import. An explicit `import Prelude` suppresses the implicit one and can refine it ([Rebindable syntax and the implicit Prelude import](https://downloads.haskell.org/ghc/latest/docs/users_guide/exts/rebindable_syntax.html)).

`Prelude` is a module of the `base` package. `base`’s own overview says the Prelude exposes a curated subset of `base`: core types such as `Bool` and `Int`, lists, tuples, `Maybe`, exceptions, IO, and concurrency ([base](https://downloads.haskell.org/ghc/latest/docs/libraries/base-4.22.0.0-66f8/index.html)). The rest of `base` (`Data.Map` is not in `base`; `System.Environment`, `Data.Maybe` as a full module, and so on) is imported by name.

### What the standard library is, and how it is grouped

There is no single package called the standard library. Three layers show up in the GHC docs:

1. **In scope automatically:** `Prelude`, a subset of `base`.
2. **Shipped with GHC, imported explicitly:** the packages in that GHC’s included-libraries table and library index. For GHC 9.8.4 the user guide lists `base` as “Core library”, `bytestring` and `containers` as dependencies of the `ghc` library, and `text` as a dependency of the `Cabal` library, among others (`directory`, `process`, `filepath`, `time`, `unix` or `Win32`, `stm`, `transformers`) ([GHC 9.8.4 release notes, included libraries](https://downloads.haskell.org/ghc/9.8.4/docs/users_guide/9.8.4-notes.html)). The library index that accompanies the latest GHC docs documents `bytestring-0.12.2.0`, `containers-0.8`, and `text-2.1.3` next to `base-4.22.0.0` ([Haskell Hierarchical Libraries](https://downloads.haskell.org/ghc/latest/docs/libraries/index.html)).
3. **Not shipped:** anything else, from Hackage. The packages chapter says GHC comes with several packages, and more can be obtained from HackageDB ([Packages](https://downloads.haskell.org/ghc/latest/docs/users_guide/packages.html)).

`base` points users at the other two data libraries: `Map` and `Set` are in `containers`; textual data should use `text` ([base](https://downloads.haskell.org/ghc/latest/docs/libraries/base-4.22.0.0-66f8/index.html)). The `Prelude` page says that, for historical reasons, `base` uses `String` in many places, and that library code dealing with user data should use `text` for Unicode text or `bytestring` for binary data ([Prelude](https://downloads.haskell.org/ghc/latest/docs/libraries/base-4.22.0.0-66f8/Prelude.html)).

`containers` documents sets, maps, sequences, trees, and graphs, and says its modules should be imported qualified because the names conflict with the Prelude ([containers introduction](https://github.com/haskell/containers/blob/master/containers/docs/intro.rst)). `bytestring` says the same about its modules ([bytestring on Hackage](https://hackage.haskell.org/package/bytestring)).

There is no testing package in the 9.8.4 included-libraries table. Application-level libraries (HTTP, CLI parsers beyond `System.Console.GetOpt` in `base`) are not in that table either.

The 9.8.4 “reason for inclusion” column matters: `containers` and `bytestring` are listed because the compiler depends on them, and `text` because Cabal does. They are not described there as a curated application standard library.

### How external libraries live

Hackage is the catalog named by the user guide. Building and installing your own package is Cabal: a configuration file plus sources ([Packages](https://downloads.haskell.org/ghc/latest/docs/users_guide/packages.html)). The `containers` introduction shows the Cabal form: a `build-depends` stanza such as `base` and `containers` with version bounds ([containers introduction](https://github.com/haskell/containers/blob/master/containers/docs/intro.rst)).

I did not use Stack’s documentation. The user guide’s contrast is between invoking `ghc` / `ghci` directly and using Cabal.

### Is a project config file required for std plus one external library?

For packages already installed and exposed, no. In `--make` or GHCi, most installed packages are available without further options. Only modules from exposed packages can be imported. Hidden packages are not importable, though they may still be linked as dependencies of exposed ones ([Packages](https://downloads.haskell.org/ghc/latest/docs/users_guide/packages.html)).

That is not true once a Cabal file is in use. The same page says Cabal ignores the exposed/hidden flag and always passes `-hide-all-packages`, so available packages are exactly the `build-depends` list. With `-hide-all-packages`, even `base` must be named with `-package`.

A library that is not already installed is a Hackage/Cabal install, which is the configuration file the user guide describes. So: Prelude plus `containers` or `text`, if that GHC build installed them exposed, does not need a project file. Prelude plus a Hackage package that is not installed does.

The `ghc-pkg list` sample in the current packages chapter is still the GHC 6.12.1 database (it lists `bytestring` and `containers`, and does not list `text`). It is an illustration of exposed versus hidden, not the current bundle. The current bundle is the included-libraries table and the library index cited above.

### How versions are pinned

With `ghc` directly, the compiler exposes one version of a package, preferring the latest non-broken installed version. `-package pkg-1.0` selects a version ([Packages](https://downloads.haskell.org/ghc/latest/docs/users_guide/packages.html)).

With Cabal, versions are bounds in `build-depends` (`containers >= 0.5.7 && < 0.6` in the containers introduction). I did not verify `cabal.project` freeze files; that is package-manager UX beyond the config-file contrast.

### Layering problems they document

The implicit Prelude and the recommended text types disagree. `String` is a list of `Char` in the Prelude, and the Prelude page tells library authors to use `text` or `bytestring` instead. `base` tells users that maps and sets are in another package.

Those packages reuse Prelude names, so the documented import style is `import qualified`. The containers introduction says this explicitly for `Data.Set`, `Data.Map.Strict`, and `Data.Sequence`.

GHC itself does not use the implicit Prelude. A comment in `GHC.Prelude.Basic` says every module in GHC is compiled with `NoImplicitPrelude` and imports `GHC.Prelude` or `GHC.Prelude.Basic` ([GHC.Prelude.Basic source, via the 9.14.0 haddocks](https://downloads.haskell.org/ghc/9.14.0.20250908/docs/libraries/ghc-9.14.0.20250908-eb93/src/GHC.Prelude.Basic.html)).

`text` and `bytestring` being “included” because Cabal or GHC depends on them means the blessed data libraries are an accident of the compiler’s own build, recorded as such in the 9.8.4 table, while the language-level default remains `Prelude`/`String`.

## Elm

### What is always available with zero import

`elm/core`’s README lists the default imports, inserted as if every file began with them: `Basics` exposing everything, `List` exposing `List` and `::`, `Maybe` exposing `Maybe(..)`, `Result` exposing `Result(..)`, `String` exposing `String`, `Char` exposing `Char`, `Tuple`, `Debug`, `Platform` exposing `Program`, `Platform.Cmd` as `Cmd`, and `Platform.Sub` as `Sub` ([elm/core README](https://github.com/elm/core/blob/master/README.md)).

The same README says the set is small on purpose: names that are very useful and unlikely to collide, so that libraries can define their own `map`, and so that it is possible to see where a name comes from.

`elm/core` is still a package dependency. The README starts with “Every Elm project needs this package.” An application `elm.json` lists `"elm/core": "1.0.0"` under `dependencies.direct` ([elm.json for applications](https://github.com/elm/compiler/blob/master/docs/elm.json/application.md)).

The package website `https://package.elm-lang.org/packages/elm/core/latest/` was fetched and returned a client-rendered shell without the module list. The README above is the source used for the default imports.

### What the standard library is, and how it is grouped

There is no monolithic std. The opinionated set is a group of `elm/*` packages, each named in `elm.json`. The application spec’s baseline is `elm/browser`, `elm/core`, `elm/html`, and `elm/json` as direct dependencies, and `elm/time`, `elm/url`, and `elm/virtual-dom` as indirect ([elm.json for applications](https://github.com/elm/compiler/blob/master/docs/elm.json/application.md)). The official guide adds `elm/http`, `elm/json`, `elm/random`, and `elm/time` as the packages used once effects come in, and says other packages live at `package.elm-lang.org` ([Commands and Subscriptions](https://guide.elm-lang.org/effects/)).

The install chapter says `elm install elm/http` and `elm install elm/json` add those dependencies so the program can `import Http` ([elm install](https://guide.elm-lang.org/install/elm)).

Tests are not an `elm/*` package in these pages. `elm init`’s hint points at [`elm-explorations/test`](https://github.com/elm-explorations/test) ([Creating an Elm project](https://github.com/elm/compiler/blob/master/hints/init.md)).

A general filesystem or process library does not appear in the baseline `elm.json`. Effects in the guide go through commands and subscriptions, then packages such as `elm/http`.

### How external libraries live

The catalog is `package.elm-lang.org` ([elm install](https://guide.elm-lang.org/install/elm)). A package’s `"name"` is a GitHub repository name, such as `"elm-lang/core"` or `"rtfeldman/elm-css"`. The spec says only GitHub repos are supported, so that author names do not collide ([elm.json for packages](https://github.com/elm/compiler/blob/master/docs/elm.json/package.md)).

You can import a module only from a direct dependency. Indirect dependencies are recorded so builds are reproducible and so the dependency list can be reviewed, and they are not the packages your code imports ([elm.json for applications](https://github.com/elm/compiler/blob/master/docs/elm.json/application.md)).

### Is a project config file required for std plus one external library?

Yes. `elm init` exists to create `elm.json` and a `src/` directory. The hint says the file lists the particular versions of `elm/core` and `elm/html` in use, and that new dependencies should be added with `elm install` rather than by hand ([Creating an Elm project](https://github.com/elm/compiler/blob/master/hints/init.md)). The compiler’s own init text, quoted in a compiler issue, begins “Hello! Elm projects always start with an elm.json file.” ([elm/compiler issue 1797](https://github.com/elm/compiler/issues/1797)).

`elm/core` plus one other package means both names are entries in `elm.json`. There is no URL import that bypasses the file.

### How versions are pinned

Applications use exact versions. The application spec says `elm.json` doubles as a lock file ([elm.json for applications](https://github.com/elm/compiler/blob/master/docs/elm.json/application.md)).

Packages use ranges. The `elm/json` example depends on `"elm/core": "1.0.0 <= v < 2.0.0"` ([elm.json for packages](https://github.com/elm/compiler/blob/master/docs/elm.json/package.md)). The same page says that in an application there is only one version of each package, which is why wide ranges on the package side are useful.

Publishing checks the version against an API diff. Packages start at `1.0.0`. `elm bump` advances the version from the API change: a patch change becomes `1.0.1`, removing a function becomes `2.0.0` ([elm.json for packages](https://github.com/elm/compiler/blob/master/docs/elm.json/package.md)). The publish path reports “Checking semantic versioning rules” and rejects a version that does not match the diff ([terminal/src/Publish.hs](https://github.com/elm/compiler/blob/2f6dd292/terminal/src/Publish.hs)). The guide’s introduction lists “Automatically enforced semantic versioning for all Elm packages” as a property of the language ([Introduction](https://guide.elm-lang.org/)).

A compiler issue records the limit of that check: `elm bump` classifies from the API diff, and a behavior change with the same types is still a patch unless the author forces a major bump, which the publisher then rejects if it disagrees with the diff ([issue 2099](https://github.com/elm/compiler/issues/2099)).

The 0.14 announcement is the earlier first-party statement of the same rule: the package manager detects API changes and requires a major version for breaking changes ([Elm 0.14](https://elm-lang.org/news/0.14)).

### Layering problems they document

`elm/core` is both ambient (default imports) and a versioned dependency that must be written down. The default import list is deliberately not the whole package: dictionaries and sets are mentioned as data structures the package provides, and they are not in the default import block ([elm/core README](https://github.com/elm/core/blob/master/README.md)).

The standard set is many packages (`elm/html`, `elm/json`, `elm/http`, `elm/browser`, …), each at its own exact version in an application. `virtual-dom` shows up as indirect under `elm/html` in the sample, so the HTML stack is more than the package you install.

The 2014 package-manager post, which is historical relative to `elm.json`, already states the goals that produced this shape: one shared version of a dependency rather than nested duplicates, and automatic semantic versioning by comparing APIs. It also says the public library is backed by GitHub ([Elm Package Manager](https://elm-lang.org/news/package-manager)). The current package spec still requires the name to be a GitHub repo.

## Kestrel (kestrel-lang.com)

### What is always available with zero import

The language docs say the standard library auto-imports its most-used names: `Int`, `String`, `Bool`, `Optional`, `Result`, `Array`, and others. The example given is that you should not have to write `import std.num.Int` ([Organization](https://kestrel-lang.com/docs/organization)). The builtins page lists primitive types (`Int`, sized integers, `Float`, `Bool`, `Char`, `String`, pointers) and three compiler intrinsics: `fatalError`, `sizeof`, `alignof` ([Builtins](https://kestrel-lang.com/docs/reference/builtins)).

The README’s sample calls `println` with no import statement ([README](https://github.com/kestrellang/kestrel/blob/main/README.md)). The organization page’s named list does not include `println`; the sample is the evidence that the documented program uses it without an import line.

Anything else is an `import` of a module path. Example from the organization page: `import std.io.stdio.println` or `import std.collections`.

### What the standard library is, and how it is grouped

The published module index is a tree of `std.*` modules, with item counts ([Standard library](https://kestrel-lang.com/reference/stdlib), also listed in [llms.txt](https://kestrel-lang.com/llms.txt)):

- Data: `std.collections`, `std.text`, `std.text.unicode`, `std.numeric`, `std.iter`, `std.result`.
- System: `std.io` and its children (`file`, `stdio`, `read`, `write`, `error`), `std.os`, `std.net` (`socket`, `libc`), `std.memory`, `std.ffi`.
- Core: `std.core`.

That index does not list a `std.test` module. I did not find a testing module in the std index or in `llms.txt`.

Application-shaped libraries are Flock packages under the `kestrel/` org, not `std` modules. The site index lists `kestrel/perch` (web server), `kestrel/swoop` (HTTP client), `kestrel/clutch` (CLI parser), `kestrel/quill` (serialization) plus JSON and TOML companions, `kestrel/http`, `kestrel/plume`, `kestrel/talon-sqlite` ([llms.txt](https://kestrel-lang.com/llms.txt)). The homepage sample imports them by module path: `import perch.app.(App)`, `import http.content.(Text, JsonBody)` ([kestrel-lang.com](https://kestrel-lang.com/)).

The repo’s module document says a file declares its module with `module std.collections`, and the path is not derived from the directory. Selective import is `import Module.(Item)`, and `public import` re-exports ([modules.md](https://github.com/kestrellang/kestrel/blob/main/docs/language/modules.md)). The website’s organization page agrees that imports are explicit and that a wildcard import is not supported.

### How external libraries live

Flock resolves dependencies from a registry or from a local path. A registry dependency is an `org/name` with a version constraint in `flock.toml`. A path dependency is `{ path = "../quill" }` ([published flock.dependency docs](https://kestrel-lang.com/llms-full.txt), section `kestrel/flock`).

The registry client fetches version lists with `GET /api/v1/packages/{org}/{pkg}` and version metadata, including a checksum and `archive_url`, with `GET /api/v1/packages/{org}/{pkg}/{version}`. `downloadFile` downloads that URL with curl. The cache root is `~/.kestrel/packages/`, and a version lives at a path like `~/.kestrel/packages/kestrel/swoop/1.0.0/`. `isCached` is true when `flock.toml` exists in that directory ([same flock API text](https://kestrel-lang.com/llms-full.txt), sections `flock.registry_source` and `flock.cache`).

The registry URL is chosen in three steps: a project `[registry]` entry in `flock.toml`, then `~/.kestrel/config.toml`, then a hardcoded default (`resolveRegistryUrl` in the same text).

Publishing uploads to that registry. `flock publish` archives the project and the package appears at `kestrel-lang.com/flock/<org>/<name>`. Authentication is a GitHub sign-in and a token in `~/.flock/credentials` or `FLOCK_TOKEN` ([Tooling: Flock](https://kestrel-lang.com/docs/tooling/flock)).

Source imports stay module names (`import perch.app.(App)`). They do not contain the download URL.

### Is a project config file required for std plus one external library?

For a program that only uses the language and `std`, the README shows `kestrel build hello.ks` with no Flock project ([README](https://github.com/kestrellang/kestrel/blob/main/README.md)).

For an external package, yes. `flock init` creates `flock.toml`. Dependencies are added under `[dependencies]`, for example `kestrel/quill = { version = "0.2.1" }` ([Getting started: Flock](https://kestrel-lang.com/docs/getting-started/flock), [Tooling: Flock](https://kestrel-lang.com/docs/tooling/flock)). The next build fetches the package and writes `flock.lock`.

### How versions are pinned

Constraints parsed by the published Flock API are `^1.2.3` (compatible: `>=1.2.3`, `<2.0.0`), `~1.2.3` (`>=1.2.3`, `<1.3.0`), an exact `1.2.3`, and `*` ([flock.version in llms-full.txt](https://kestrel-lang.com/llms-full.txt)). The tooling page’s example uses an exact `0.2.1`.

`flock.lock` records the resolved graph. The lock entry has a version, a source of `"registry"` or `"path"`, and an optional checksum such as `sha256:…`. The docs say to commit `flock.lock` for applications, and that libraries usually do not ([Tooling: Flock](https://kestrel-lang.com/docs/tooling/flock), lock types in [llms-full.txt](https://kestrel-lang.com/llms-full.txt)). Published versions are immutable; a fix is a new version ([Tooling: Flock](https://kestrel-lang.com/docs/tooling/flock)).

### Layering problems visible in the docs

I did not find a Kestrel post-mortem equivalent to Deno’s HTTP-import essay or Haskell’s Prelude note. What the docs show side by side:

- A small auto-import, then an explicit `std.*` tree, then `kestrel/*` packages that are imported like user modules (`perch`, `http`) rather than under `std`.
- The organization page’s example `import std.num.Int` does not match the published module index, which lists `std.numeric` rather than `std.num` ([Organization](https://kestrel-lang.com/docs/organization), [stdlib index](https://kestrel-lang.com/reference/stdlib)).
- The website organization page lists four visibilities (`public`, `internal`, `fileprivate`, `private`). The repo language document lists three (`public`, `internal`, `private`) ([Organization](https://kestrel-lang.com/docs/organization), [modules.md](https://github.com/kestrellang/kestrel/blob/main/docs/language/modules.md)). Both were live on 3 October 2026. They disagree.
- The flock.dependency enum documents a `Registry(VersionConstraint)` case with the comment “future”, while `RegistrySource` and the tooling page describe registry installs as the current path ([llms-full.txt](https://kestrel-lang.com/llms-full.txt), [Tooling: Flock](https://kestrel-lang.com/docs/tooling/flock)). The API text and the user-facing page are not the same story about whether registry dependencies are finished.

## Implications

These are consequences of the facts above for a language that wants a rich standard library, external libraries hosted on GitHub, an opinionated split into data, system, test, and application, natural import names, and no project config file.

**No config file and one external library only coexist in the systems that put the locator in the source.** Deno still runs a single file that imports `jsr:@std/...` and `jsr:` or `https:` third-party specifiers with no `deno.json` ([HTTP imports](https://deno.com/blog/http-imports), [Standard Library](https://docs.deno.com/runtime/reference/std/)). Elm requires `elm.json` before `elm/core` and any other package can be used ([hints/init.md](https://github.com/elm/compiler/blob/master/hints/init.md)). Kestrel’s documented single-file command does not cover an external package; that package is a `flock.toml` entry ([README](https://github.com/kestrellang/kestrel/blob/main/README.md), [Tooling: Flock](https://kestrel-lang.com/docs/tooling/flock)). Bun’s documented way to add a third-party package writes `package.json` ([bun add](https://bun.sh/docs/pm/cli/add)). Haskell is the other no-config path, and only for packages already installed and exposed, which for `containers` and `text` happens because they shipped with GHC, not because the source named a URL ([Packages](https://downloads.haskell.org/ghc/latest/docs/users_guide/packages.html)).

**GitHub as the host showed up in two different ways, and neither one removed the need for a version rule.** Elm’s package name is a GitHub repo, and the compiler still requires `elm.json` plus an API-diff version check ([elm.json for packages](https://github.com/elm/compiler/blob/master/docs/elm.json/package.md)). Deno’s retrospective uses a raw GitHub URL inside an import map as an example of the HTTP style they moved away from recommending, because a URL has no semver and an arbitrary host can be down even if a previous run was cached ([HTTP imports](https://deno.com/blog/http-imports)). Bun can record a `git+https` GitHub URL, and it records it in `package.json` ([bun add](https://bun.sh/docs/pm/cli/add)).

**A rich std that is split into many versioned units stops being one library.** Deno’s std moved from one `deno.land/std@x.y.z` tree to independently versioned `@std` packages, with a compatibility leftover at the old URL ([std on JSR](https://deno.com/blog/std-on-jsr)). Elm’s baseline is several `elm/*` packages at exact versions, plus indirect packages the application did not name ([elm.json for applications](https://github.com/elm/compiler/blob/master/docs/elm.json/application.md)). Kestrel’s data and system modules are `std.*`, while CLI, HTTP, and SQLite are separate `kestrel/*` packages with their own versions ([llms.txt](https://kestrel-lang.com/llms.txt)). In all three, “the standard library” is not one version number.

**What is always in scope collides with the data library if the prelude is wide.** Haskell’s Prelude exports list operations under names that `containers` and `bytestring` also use, and both packages document qualified imports as the remedy ([containers introduction](https://github.com/haskell/containers/blob/master/containers/docs/intro.rst), [bytestring](https://hackage.haskell.org/package/bytestring)). The Prelude page tells authors not to use the in-scope `String` for user data ([Prelude](https://downloads.haskell.org/ghc/latest/docs/libraries/base-4.22.0.0-66f8/Prelude.html)). Elm’s core README states the opposite choice: keep the default import list small so a library `map` does not collide ([elm/core README](https://github.com/elm/core/blob/master/README.md)). Kestrel’s documented auto-import is a short list of types, with collections imported explicitly ([Organization](https://kestrel-lang.com/docs/organization)).

**Shipping another ecosystem’s builtins next to your own produces two stds.** Bun documents Bun-native file, HTTP, and test APIs and a large `node:*` compatibility surface at the same time ([Bun APIs](https://bun.sh/docs/runtime/bun-apis), [Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)). Deno documents the same overlap among the `Deno` global, `@std`, and `node:` ([Deno namespace](https://docs.deno.com/api/deno/), [std index](https://docs.deno.com/runtime/reference/std/), [API reference](https://docs.deno.com/api/)).

**Integrity pins were attached to a file on disk in every system that has them.** Deno’s integrity lock is `deno.lock`, created when `deno.json` or `package.json` is present; a lone URL or `jsr:` specifier in a config-less script pins a version in the source text and does not, by those pages, record a hash ([Lock dependencies](https://docs.deno.com/examples/dependency_lockfile_tutorial/)). Elm’s application `elm.json` is the lock file, so the config file and the pin are the same artifact ([elm.json for applications](https://github.com/elm/compiler/blob/master/docs/elm.json/application.md)). Kestrel writes `flock.lock` with checksums when it resolves `flock.toml` ([Tooling: Flock](https://kestrel-lang.com/docs/tooling/flock)). Bun writes `bun.lock` from `bun install` ([bun install](https://bun.sh/docs/pm/cli/install)). None of the cited pages shows a content hash for an external library with no project file and no lockfile.

**A sandbox does not, by itself, force a config file.** Deno’s permission checks apply even to a single-file script, and static remote imports load without a network permission ([Security](https://docs.deno.com/runtime/fundamentals/security/)). The config file is optional for the import. The permission flag is not.

## Sources that could not be verified

- No primary page was found in which a language named Kestrel imports modules by `https://` URL. Searches covered the four candidates above, `kestrel-lang.com`’s docs and `llms-full.txt`, and the public parser. GitHub’s code-search API returned 401, so a full-text search of the compiler tree was not available that way. The grammar file and `path.rs` were read instead.
- `https://kestrel-lang.com/sitemap.xml` returned HTTP 500. `https://kestrel-lang.com/docs/flock` returned HTTP 404. The Flock user docs that did load are `/docs/getting-started/flock` and `/docs/tooling/flock`.
- `https://package.elm-lang.org/packages/elm/core/latest/` did not return the module documentation (the fetch was a client-rendered shell). Default imports are cited from the `elm/core` README on GitHub.
- The `ghc-pkg list` example in the current GHC 9.14.1 packages chapter is a GHC 6.12.1 database. It was not used as the list of libraries in a current GHC. The included-libraries table cited is from the GHC 9.8.4 release notes. A 9.14.1 included-libraries table was not fetched. The latest library index was fetched and does document `base`, `containers`, `bytestring`, and `text` for that GHC’s bundled docs.
- An explicit Bun statement that builtins work with no `package.json` was not found. The SQLite page shows a single file and does not mention a manifest.
