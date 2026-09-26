/*
 * mn_panic — the runtime's terminal failure path.
 *
 * `panic` compiles to a call here followed by `unreachable` (spec §2.5).
 * The message goes to fd 2, never fd 1 — fd 1 carries only the compiled
 * program's own output (spec §2.16), and a panic must never contaminate it.
 */
#include "menard.h"

#include <string.h>
#include <unistd.h>

/*
 * `_exit`, not `abort`: the runtime writes its own message and owns the
 * exit code directly (1 — "program error/panic", matching the host CLI's
 * convention), rather than raising SIGABRT and leaving the code to the
 * shell. There is no stdio buffering here to flush; the write below is the
 * only output this path produces.
 */
_Noreturn void mn_panic(const char *message) {
  if (message != NULL) {
    size_t len = strlen(message);
    write(2, message, len);
  }
  write(2, "\n", 1);
  _exit(1);
}
