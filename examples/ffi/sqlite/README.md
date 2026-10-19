# SQLite — Menard FFI proving ground

Cross-platform binding to SQLite via a thin C bridge. Not part of `stdlib/` or
the Runtime ABI (`mn_*`).

```
sqlite.mnd  →  extern sql_*  →  sql_ffi.c  →  sql_bridge.c  →  libsqlite3
```

## Why SQLite (not EventKit)

Build B needs a real foreign library with an explicit `MnWord` conversion
layer. SQLite is available on Darwin and Linux, needs no TCC / `.app` bundle,
and keeps `./mn` unchanged — only a dedicated link target.

## Build / run

```bash
make sqlite-native
./build/sqlite demo
./build/sqlite exec :memory: "CREATE TABLE t(x); INSERT INTO t VALUES (1);"
./build/sqlite query :memory: "SELECT 1 AS n, 'hi' AS s;"
```

Requires `libsqlite3` (`pkg-config --libs sqlite3` or system `-lsqlite3`).

## Public API (`sqlite.mnd`)

| Function | Meaning |
|---|---|
| `open(path)` | Open a file or `:memory:` (closes any prior connection) |
| `close()` | Close the connection |
| `exec(sql)` | DDL / DML with no row results |
| `query(sql)` | List of row maps (`Map Str Json`) |
| `query-json(sql)` | Raw JSON array string from the bridge |
| `errmsg()` | Last SQLite / bridge error text |

## Interpreter / CI

`sql_*` is unbound in the TypeScript host. Dual-host agreement is not claimed.
Live smoke: `make sqlite-native && ./build/sqlite demo`.
