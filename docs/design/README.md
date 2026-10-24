# Design history — libraries and concurrency

Architecture and ship plans for Builds A–F. Frozen as history; living language docs stay under [../](../). Map of all docs: [../README.md](../README.md).

## Architecture

| Doc | Status |
| --- | --- |
| [libraries-concurrency.md](libraries-concurrency.md) | Architecture complete — stop general design revision; implement |
| [ffi.md](ffi.md) | Draft — foreign FFI / packages follow-on after the concurrency track |
| [buildout-libraries-concurrency.md](buildout-libraries-concurrency.md) | Planning — six builds, dependencies, open questions |

## Builds

| Build | Doc | Status |
| --- | --- | --- |
| A | Platform foundation (in [buildout](buildout-libraries-concurrency.md)) | Shipped with Platform API work |
| B | FFI proving ground (SQLite; see [ffi.md](ffi.md)) | Shipped |
| C | [builds/c-suspension.md](builds/c-suspension.md) | Done (acceptance green on native + interpreter) |
| D | [builds/d-tasks.md](builds/d-tasks.md) | Done (native + interpreter acceptance green) |
| E | [builds/e-actors.md](builds/e-actors.md) | Done (native + interpreter acceptance green) |
| F | [builds/f-network.md](builds/f-network.md) | Implemented (native networking; interpreter unbound for net/TLS) |

Old root paths (`docs/design-libraries-concurrency.md`, `docs/build-f-network.md`, …) remain as short stubs that link here.
