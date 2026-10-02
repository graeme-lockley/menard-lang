/*
 * mn_panic — the runtime's terminal failure path.
 *
 * `panic` compiles to a call here followed by `unreachable` (spec §2.5).
 * The message goes to fd 2, never fd 1 — fd 1 carries only the compiled
 * program's own output (spec §2.16), and a panic must never contaminate it.
 */
#include "menard.h"

#include <stdint.h>
#include <string.h>
#include <unistd.h>

#define MN_TRACE_MAX 256

typedef struct {
  const char *file;
  int64_t line;
} MnTraceFrame;

static MnTraceFrame mn_trace[MN_TRACE_MAX];
static int mn_trace_len;

static void write_all(const char *p, size_t n) {
  while (n > 0) {
    ssize_t w = write(2, p, n);
    if (w <= 0) {
      return;
    }
    p += (size_t)w;
    n -= (size_t)w;
  }
}

static void write_str(const char *s) {
  if (s != NULL) {
    write_all(s, strlen(s));
  }
}

static void write_i64(int64_t n) {
  char buf[32];
  int i = (int)sizeof(buf);
  uint64_t u;
  if (n < 0) {
    u = (uint64_t)(-(n + 1)) + 1;
  } else {
    u = (uint64_t)n;
  }
  if (u == 0) {
    write_all("0", 1);
    return;
  }
  while (u > 0 && i > 0) {
    buf[--i] = (char)('0' + (u % 10));
    u /= 10;
  }
  if (n < 0 && i > 0) {
    buf[--i] = '-';
  }
  write_all(buf + i, sizeof(buf) - (size_t)i);
}

static void write_at(const char *file, int64_t line) {
  write_str("  at ");
  write_str(file != NULL ? file : "");
  write_all(":", 1);
  write_i64(line);
  write_all("\n", 1);
}

static void write_trace(void) {
  for (int i = mn_trace_len - 1; i >= 0; i--) {
    write_at(mn_trace[i].file, mn_trace[i].line);
  }
}

void mn_trace_push(const char *file, int64_t line) {
  if (mn_trace_len >= MN_TRACE_MAX) {
    return;
  }
  mn_trace[mn_trace_len].file = file;
  mn_trace[mn_trace_len].line = line;
  mn_trace_len++;
}

void mn_trace_pop(void) {
  if (mn_trace_len > 0) {
    mn_trace_len--;
  }
}

/*
 * `_exit`, not `abort`: the runtime writes its own message and owns the
 * exit code directly (1 — "program error/panic", matching the host CLI's
 * convention), rather than raising SIGABRT and leaving the code to the
 * shell. There is no stdio buffering here to flush; the write below is the
 * only output this path produces.
 */
_Noreturn void mn_panic(const char *message) {
  write_str(message);
  write_all("\n", 1);
  write_trace();
  _exit(1);
}

_Noreturn void mn_panic_at(const char *file, int64_t line, const char *message) {
  write_str(file != NULL ? file : "");
  write_all(":", 1);
  write_i64(line);
  write_all(": panic: ", 9);
  write_str(message);
  write_all("\n", 1);
  write_trace();
  _exit(1);
}
