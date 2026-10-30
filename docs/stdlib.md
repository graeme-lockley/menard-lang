# The standard library

Import a module by name: `import std/list as List`. The value a pipe feeds is the last parameter, except where a function acts on a mutable cell or a path. Those take the cell or the path first.

`std/basics` is in scope in every module. Everything else is an explicit import.

A missing `Maybe` or a failed `Result` is `?` (the `Err` payload is dropped on the default path). `to-maybe` remains when a real `Maybe` is needed downstream.

`show` of a `Float` uses the canonical shortest-round-trip spelling (see
[menard-spec.md](menard-spec.md) §2.13): `1.0`, `0.1`, `1e+21`, `nan`, `inf`,
`-inf`. Non-finite values are ordinary floats, not panics.

## Basics

In scope without an import.

| Function | |
| --- | --- |
| `id(x)` | Returns `x`. |
| `always(x)` | A function that ignores its argument and returns `x`. `xs \|> List.map(always(0))`. |
| `not(b)` | Logical negation. |
| `min(x, y)` | The smaller integer. |
| `max(x, y)` | The larger integer. |
| `abs(n)` | Absolute value. |
| `clamp(lo, hi, n)` | `n` limited to `lo` through `hi`. |

## Maybe

`import std/maybe as Maybe`

| Function | |
| --- | --- |
| `map(f, m)` | Apply `f` to a `Some`. `m \|> Maybe.map(f)`. |
| `and-then(f, m)` | Replace a `Some` with the `Maybe` that `f` returns. |
| `map2(f, ma, mb)` | Apply `f` when both are `Some`. `mb \|> Maybe.map2(f, ma)`. |

`xs \|> List.head() ? 0` is the fallback. The right-hand side of `?` runs only on `None`.

## Result

`import std/result as Result`

| Function | |
| --- | --- |
| `map(f, r)` | Apply `f` to an `Ok`. |
| `and-then(f, r)` | Replace an `Ok` with the `Result` that `f` returns. |
| `map2(f, ra, rb)` | Apply `f` when both are `Ok`. The error type is shared. |
| `map-error(g, r)` | Apply `g` to an `Err`. |
| `to-maybe(r)` | The `Ok` value, or `None`. Prefer `r ? 0` when only a default is needed. |
| `from-maybe(err, m)` | `Ok` of a `Some`, or `Err(err)`. `m \|> Result.from-maybe(err)`. |

## List

`import std/list as List`

| Function | |
| --- | --- |
| `length(xs)` | How many elements. |
| `is-empty(xs)` | Whether `xs` is `[]`. |
| `head(xs)` | The first element, or `None`. `xs \|> List.head() ? 0`. |
| `tail(xs)` | `xs` without its first element, or `None`. |
| `singleton(x)` | A list of one element. |
| `repeat(n, x)` | `n` copies of `x`. |
| `range(lo, hi)` | The integers from `lo` through `hi`, inclusive. |
| `nth(i, xs)` | The element at `i`, or `None`. `xs \|> List.nth(i) ? 0`. |
| `append(extra, xs)` | `xs` followed by `extra`. `xs \|> List.append(extra)`. |
| `reverse(xs)` | Last to first. |
| `map(f, xs)` | `f` on each element. `xs \|> List.map(f)`. |
| `indexed-map(f, xs)` | `f` on each index and element, from zero. |
| `for-each(f, xs)` | Call `f` on each element for side effects. |
| `for-each-indexed(f, xs)` | Call `f` on each index and element, from zero. |
| `filter(f, xs)` | The elements for which `f` is true. |
| `filter-map(f, xs)` | The `Some` values of `f`. |
| `partition(f, xs)` | A product of the elements that pass and the elements that do not. |
| `intersperse(sep, xs)` | `sep` between the elements. |
| `fold(f, acc, xs)` | `f` from the left, starting at `acc`. `f` is `(acc, element) -> acc`. |
| `sum(xs)` | The sum of a `List Int`. Empty sums to `0`. |
| `product(xs)` | The product of a `List Int`. Empty multiplies to `1`. |
| `minimum(xs)` | The smallest `Int`, or `None`. |
| `maximum(xs)` | The largest `Int`, or `None`. |
| `zip(xs, ys)` | Pairs, until either list ends. |
| `unzip(pairs)` | The firsts and the seconds. |
| `member(x, xs)` | Whether `x` occurs, compared with `==`. |
| `sort(xs)` | The derived order of `compare`. |
| `sort-by(key, xs)` | Ordered by `key`. Equal keys keep the earlier element first. |
| `find(f, xs)` | The first element for which `f` is true, or `None`. |
| `any(f, xs)` | Whether `f` is true for any element. |
| `all(f, xs)` | Whether `f` is true for every element. |
| `concat(xss)` | The elements of each list, in order. |
| `flat-map(f, xs)` | The lists returned by `f`, joined. |
| `take(n, xs)` | The first `n` elements. |
| `drop(n, xs)` | `xs` without its first `n` elements. |

## Map

`import std/map as Map`

A map is persistent. Keys are orderable, and `keys` returns them in that order. A literal `{ "a" => 1, "b" => 2 }` is the same operation. A later entry keeps the key.

`set`, `lookup`, and `has` are Menard functions. A literal still lowers to the intrinsics `map-set`, `map-get`, and `map-keys`, which take the map first.

| Function | |
| --- | --- |
| `empty()` | A map with no entries. |
| `singleton(k, v)` | A map of one entry. |
| `set(k, v, m)` | `m` with `k` mapped to `v`. `m \|> Map.set(k, v)`. |
| `lookup(k, m)` | The value at `k`, or `None`. `m \|> Map.lookup(k) ? 0`. |
| `has(k, m)` | Whether `k` is a key. |
| `size(m)` | How many keys. |
| `is-empty(m)` | Whether `m` has no entries. |
| `keys(m)` | The keys, in order. |
| `values(m)` | The values, in key order. |
| `from-list(pairs)` | A map of the pairs. A repeated key keeps the last value. |
| `to-list(m)` | The entries, as pairs, in key order. |
| `map(f, m)` | `f(key, value)` for each value. Keys stay. |
| `filter(f, m)` | The entries for which `f(key, value)` is true. |
| `fold(f, acc, m)` | `f` over the entries in key order. `f` is `(acc, key * value) -> acc`. |
| `remove(k, m)` | `m` without `k`. |
| `merge(overlay, base)` | `base`, then `overlay`. Overlap keeps `overlay`. `base \|> Map.merge(overlay)`. |

## Tuple

`import std/tuple`

Helpers over the product type `a * b`. Projection is `p.1` / `p.2`.

| Function | |
| --- | --- |
| `map-fst(f, p)` | `f` on the first component. |
| `map-snd(f, p)` | `f` on the second component. |
| `map-both(f, g, p)` | `f` on the first and `g` on the second. |

## String

`import std/string as String`

`Str` is bytes. Indexes are byte indexes. The string is last.

| Function | |
| --- | --- |
| `length(s)` | The number of bytes. |
| `byte(i, s)` | The byte at `i`, or `0` when `i` is outside `s`. |
| `slice(start, len, s)` | `len` bytes from `start`. Bounds outside `s` are clamped. |
| `concat(a, b)` | `a` and `b` joined. Further arguments nest to the left. |
| `from-char(c)` | `c` encoded as UTF-8. |
| `from-int(n)` | The decimal spelling of `n`. |
| `is-digit-byte(b)` | Whether `b` is an ASCII digit byte (`48..57`). |
| `hex-value(b)` | `0..15` for an ASCII hex digit byte, or `None`. |
| `is-empty(s)` | Whether `s` has no bytes. |
| `starts-with(prefix, s)` | Whether `s` begins with `prefix`. |
| `ends-with(suffix, s)` | Whether `s` ends with `suffix`. |
| `contains(needle, s)` | Whether `needle` occurs. `s \|> String.contains(needle)`. |
| `drop(n, s)` | `s` without its first `n` bytes. |
| `drop-right(n, s)` | `s` without its last `n` bytes. |
| `left(n, s)` | The first `n` bytes. |
| `right(n, s)` | The last `n` bytes. |
| `repeat(n, s)` | `n` copies of `s`. |
| `replace(from, to, s)` | Every `from` replaced by `to`. |
| `trim(s)` | Without leading or trailing ASCII whitespace. |
| `trim-left(s)` | Without leading ASCII whitespace. |
| `trim-right(s)` | Without trailing ASCII whitespace. |
| `index-of(sep, s)` | The byte index of `sep`, or `None`. |
| `index-of-from(sep, i, s)` | The same, at or after `i`. `s \|> String.index-of-from(sep, i)`. |
| `split(sep, s)` | The pieces between `sep`. |
| `split-using(seps, s)` | The pieces between any separator in `seps`. |
| `join(sep, parts)` | `parts` joined by `sep`. |
| `lines(s)` | The lines. A trailing newline does not add an empty last line. |
| `words(s)` | The pieces separated by ASCII whitespace. |

Whitespace for `trim` and `words` is space, tab, newline, and carriage return.

## Char

`import std/char as Char`

Predicates and ASCII case, using character literals. There is no conversion between a `Char` and its code point.

| Function | |
| --- | --- |
| `is-digit(c)` | `'0'` through `'9'`. |
| `is-upper(c)` | `'A'` through `'Z'`. |
| `is-lower(c)` | `'a'` through `'z'`. |
| `is-alpha(c)` | An ASCII letter. |
| `is-whitespace(c)` | Space, tab, newline, or carriage return. |
| `to-upper(c)` | An ASCII lowercase letter as uppercase. Other characters stay. |
| `to-lower(c)` | An ASCII uppercase letter as lowercase. Other characters stay. |

## Int

`import std/int as Int`

| Function | |
| --- | --- |
| `parse(s)` | The leading digits, or `0` when there are none. `"-"` is `0`. `"456abc"` is `456`. |
| `from-str(s)` | `Some` of the integer when every byte belongs to it, otherwise `None`. `"456abc"` is `None`. |

`String.from-int` is the other direction.

## StringBuffer

`import std/string-buffer as Buf`

A mutable buffer. The buffer is the first parameter. `!` marks the operations that change it.

| Function | |
| --- | --- |
| `new()` | An empty buffer. |
| `append!(sb, s)` | Write `s` onto the end. |
| `append-byte!(sb, b)` | Write one byte, `0..255`. |
| `append-show!(sb, v)` | Write `show(v)`. `v` has to be showable. |
| `length(sb)` | How many bytes are buffered. |
| `clear!(sb)` | Drop the contents. |
| `to-str(sb)` | The bytes as a `Str`. A later append copies, so the `Str` stays put. |
| `take-str!(sb)` | The bytes as a `Str`, and the buffer is empty afterwards. |

## Io

`import std/io`

| Name | |
| --- | --- |
| `stdin`, `stdout`, `stderr` | The file descriptors `0`, `1`, and `2`. |
| `write(fd, data)` | Write bytes. `Result Unit IoError`. |
| `write-line(fd, data)` | Write bytes and a newline. |
| `read-file(path)` | The contents of a file. |
| `write-file(path, data)` | Replace a file's contents. |

`IoError` is `NotFound`, `Permission`, `Exists`, `IsADirectory`, `NotADirectory`, `InvalidPath`, `TooLarge`, or `Other`.

## Fs

`import std/fs`

Paths come first. These are questions and actions on the filesystem, not values to pipe.

| Function | |
| --- | --- |
| `exists(path)` | Whether a file or directory is there. |
| `is-dir(path)` | Whether `path` is a directory. |
| `list-dir(path)` | The names in a directory, as one string of lines. |
| `rename(from, to)` | Rename a path. `Result Unit IoError`. |
| `remove(path)` | Remove a file. |
| `ensure-dir(path)` | Create a directory, including parents. |
| `realpath(path)` | The canonical path. |
| `mtime(path)` | The modification time in epoch milliseconds (`0` if missing). |
| `cwd()` | The working directory. |
| `isatty(fd)` | Whether a descriptor is a terminal. |

## Time

`import std/time`

Wall clock, durations, civil time with fixed UTC offsets (no IANA zones), and
minimal ISO-8601. The OS clock is the only seam call (`now-ms`).

| Name | |
| --- | --- |
| `now-ms()` | Wall-clock milliseconds since the Unix epoch. |
| `now()` | The current `Instant`. |
| `from-posix-ms(ms)` / `to-posix-ms(t)` | Instant ↔ epoch ms. |
| `of-millis` / `of-seconds` / `of-minutes` / `of-hours` / `of-days` | Build a `Duration`. |
| `duration-ms(d)` | Milliseconds in a duration. |
| `add` / `sub` / `diff` | Combine instants and durations. |
| `compare-instant` / `compare-duration` | Ordering. |
| `utc()` / `fixed-offset(mins)` / `offset-minutes(o)` | Fixed offsets (east-positive). |
| `to-datetime` / `from-datetime` | Instant ↔ civil `DateTime`. |
| `format` / `parse` | ISO-8601 with `Z` or `±HH:MM`. |

## Path

`import std/path`

POSIX path strings and URL-shaped strings. Pure Menard; path is last for pipes.

| Function | |
| --- | --- |
| `is-absolute` / `is-relative` | Leading `/` or not. |
| `join(segment, path)` | Join; absolute `segment` replaces `path`. |
| `dirname` / `basename` / `extname` | Split components. |
| `normalize` | Resolve `.` / `..` (no symlinks). |
| `split` | Path segments as a list. |
| `parse-url` / `build-url` | `scheme://host/path?query#fragment`. |

## Json

`import std/json`

| Name | |
| --- | --- |
| `Json` | `JsonNull`, `JsonBool`, `JsonInt`, `JsonFloat`, `JsonStr`, `JsonArray`, `JsonObject`. |
| `encode(v)` | JSON text. |
| `decode(s)` | `Result Json JsonError`. |

Integer tokens that fit `Int` decode as `JsonInt`; fractions, exponents, and
out-of-range integers decode as `JsonFloat`.

## Proc

`import std/proc`

A child is an argument vector. There is no shell string.

| Function | |
| --- | --- |
| `spawn(argv)` | Run a program. `Result SpawnStatus SpawnError`. |
| `spawn-capture(argv, stdin)` | Run it and collect stdout and stderr. |
| `status-exit-code(s)` | `Exited(n)` as `n`, `Signalled(n)` as `128 + n`. |

`SpawnStatus` is `Exited` or `Signalled`. `SpawnOutput` holds the status and the two captured strings.

## Sys

`import std/sys`

| Function | |
| --- | --- |
| `exit(code)` | End the process with `code`. |
| `arg-count()` | How many arguments the program received. |
| `arg(i)` | Argument `i`. |
| `getenv(name)` | An environment variable, or `None`. |

## Task

`import std/task as Task`

Cooperative single-mutator tasks. There is no public park/wake — suspension
happens inside join, yield, mailbox receive, and (later) parkable I/O.

| Name | |
| --- | --- |
| `Cancelled` | Unit error from a cancelled join. |
| `JoinTimeout` | Outer error from `join-timeout` (child keeps running). |
| `Task a` | Opaque handle (`Tid` constructor); phantom result type `a`. |
| `Scope` | `Ref (List Int)` of child ids for structured lifetimes. |
| `spawn(thunk)` | Start a zero-argument thunk; returns `Task a`. |
| `spawn-in(scope, thunk)` | Spawn and register the child on `scope`. |
| `join(t)` | `Result a Cancelled` — wait until done or cancelled. |
| `join-timeout(t, ms)` | `Result (Result a Cancelled) JoinTimeout` — relative deadline; does not cancel the child. |
| `sleep-ms(ms)` | `Result Unit Cancelled` — real timer natively; virtual clock in the interpreter. |
| `yield()` | Cooperative yield (may suspend). |
| `cancel(t)` | Request cancellation. |
| `scope(body)` | Run `body(scope)`; on exit cancel and join children. |
| `id(t)` | Debug task id (`Int`); not a wake handle. |
| `self()` | Current task id. |

**Suspend points (v1):** `join`, `yield`, `scope` exit (via join), and
`Actor` receive/call (see below). Other Platform ops must not hide scheduling
points.

## Actor

`import std/actor as Actor`

Mailboxes and actors on the task runtime (Menard queues + wait cells). Not an
isolation boundary — shared `Ref` across tasks is allowed. See
[build-e-actors.md](design/builds/e-actors.md).

| Name | |
| --- | --- |
| `ActorError` | `ActorCancelled` \| `ActorDead` \| `ActorTimeout`. |
| `Mailbox a` | Two-list queue; receive + space wait cells; **bounded** (default 1024). |
| `mailbox-new()` / `mailbox-new-bounded(n)` | Empty live mailbox. |
| `send(mb, msg)` | Enqueue; **parks when full**; `Err` on cancel/death. |
| `send-timeout(mb, msg, ms)` | Like `send`; `Err(ActorTimeout)` if still full after `ms`; nothing enqueued. |
| `receive(mb)` | Dequeue or wait; `Err` on cancel/death (no lost message on cancel). |
| `receive-timeout(mb, ms)` | Like `receive`; `Err(ActorTimeout)` leaves the queue unchanged. |
| `close(mb)` | Mark dead; wake **every** parked receiver and blocked sender (`notify-all`). Each sees `Err(ActorDead)` once. Idempotent. |
| `Pid a` | Actor identity (mailbox + task id + nursery scope). |
| `spawn` / `spawn-in` | Task + mailbox; body runs the receive loop. |
| `cast(pid, msg)` | Send to an actor. |
| `Ask[req, res]` | Envelope for typed request/response. |
| `call(pid, req)` | Reply mailbox + park; protocols need no reply Pid fields. |
| `serve` / `serve-state` | Request/response server helpers (and `*-in` for scopes). |
| `cancel` / `join` / `id` | Lifecycle; cancel escalates the nursery. |
| `register` / `whereis` | Process-local name → Pid (honor-system typing). |

**Suspend points:** `receive`, `call`, `send` (when full).

## Supervisor

`import std/supervisor as Supervisor`

OTP-lite helpers (Build F). See [build-f-network.md](design/builds/f-network.md).

| Name | |
| --- | --- |
| `ChildSpec` / `Restart` / `Strategy` | Permanent / transient / temporary; one-for-one. |
| `start-children(specs)` | Start each child once; return Pids. |
| `stop-children(pids)` | Cancel each Pid. |
| `restart-child(spec)` | Start one child again. |
| `supervise(specs)` | One-for-one watchers (scaffolding); prefer start/stop for explicit lifecycle. |
| `should-restart(policy, cancelled)` | Permanent always; Transient on cancel; Temporary never. |

## Net

`import std/net as Net`

Parkable TCP/UDP and OpenSSL TLS. **Native only** (interpreter unbound).

| Name | |
| --- | --- |
| `listen` / `accept` / `connect` / `read` / `write` / `close` | TCP (unbounded park). |
| `accept-timeout` / `connect-timeout` / `read-timeout` / `write-timeout` | Relative ms; `Err(Timeout)`; on timeout the fd stays open and usable (connect closes the half-open socket). |
| `with-connection(fd, body)` | `defer` close around `body`. |
| `udp-bind` / `udp-send` / `udp-recv` / `udp-close` | UDP. |
| `tls-client` / `tls-server` / `tls-read` / `tls-write` / `tls-close` | TLS over a TCP fd (cooperative park). |
| `tls-*-timeout` | Relative-ms TLS handshake / I/O. |
| `with-tls(id, body)` | `defer` tls-close. |

`IoError` includes `Timeout` (tag 28).

## Http / Rest

`import std/http as Http` · `import std/rest as Rest`

Menard HTTP/1.1 (request line + headers + Content-Length) and small REST helpers.

| Name | |
| --- | --- |
| `Request` / `Response` / `Method` / `HttpError` | Core types. |
| `read-request` / `write-response` | Per-connection. |
| `serve(port, handler)` | Accept loop under `Task.scope` with a default per-connection deadline (30s). |
| `serve-timeout(port, conn-ms, handler)` | Same, with an explicit per-connection deadline. |
| `request(host, port, req)` | One-shot client (unbounded). |
| `request-timeout(host, port, req, ms)` | One-shot client under a relative deadline. |
| `Rest.ok-json` / `not-found` / `path-segments` / `json-body` | REST helpers. |

## Console

`import std/console`

| Function | |
| --- | --- |
| `tty-color(fd)` | Whether color should be used on `fd`. |
| `paint(on, code, s)` | Wrap `s` in an ANSI code when `on` is true. |

## Cli

`import std/cli`

Parsing an argument list that the program already holds.

| Name | |
| --- | --- |
| `Flag(name, takes-value)` | A flag, and whether the next word is its value. |
| `has-flag(args, name)` | Whether `name` occurs. |
| `flag-value(args, name)` | The word after `name`, or `""`. |
| `positionals(args, flags)` | The words that are not flags. |
| `positional(args, flags, index)` | One of those words. |
| `args-after(args)` | The words after the first `--`. |

## Test

`import std/test`

Used by `./mn test`. A `*.test.mnd` file is a test file, and so is any other `.mnd` file whose source contains `@test`.

| Name | |
| --- | --- |
| `Counts(passed, failed)` | How many lines passed and failed. |
| `discover(path)` | The test files under `path`. |
| `count-lines(lines)` | Pass and fail totals from a test process's stdout. |
| `summary-text(c, ms)` | The summary sentence. |
| `summary(c, ms, on)` | Write that sentence. Failures are red and passes green when `on` is true. |
