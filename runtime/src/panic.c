/*
 * mn_panic — the runtime's terminal failure path.
 *
 * `panic` compiles to a call here followed by `unreachable` (spec §2.5).
 * The message goes to fd 2, never fd 1 — fd 1 carries only the compiled
 * program's own output (spec §2.16), and a panic must never contaminate it.
 *
 * When MENARD_JSON_DIAG is set, write one JSON panic object to fd 2 instead
 * of the human `file:line: panic: …` form (TOOL-03).
 */
#include "menard.h"

#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
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

static int json_diag_on(void) {
  const char *v = getenv("MENARD_JSON_DIAG");
  return v != NULL && v[0] != '\0';
}

/* Escape a string as a JSON string value (including surrounding quotes). */
static void write_json_str(const char *s) {
  write_all("\"", 1);
  if (s == NULL) {
    write_all("\"", 1);
    return;
  }
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    unsigned char c = *p;
    if (c == '"' || c == '\\') {
      write_all("\\", 1);
      write_all((const char *)&c, 1);
    } else if (c == '\n') {
      write_all("\\n", 2);
    } else if (c == '\r') {
      write_all("\\r", 2);
    } else if (c == '\t') {
      write_all("\\t", 2);
    } else if (c < 0x20) {
      char esc[7];
      esc[0] = '\\';
      esc[1] = 'u';
      esc[2] = '0';
      esc[3] = '0';
      esc[4] = "0123456789abcdef"[c >> 4];
      esc[5] = "0123456789abcdef"[c & 15];
      esc[6] = '\0';
      write_str(esc);
    } else {
      write_all((const char *)&c, 1);
    }
  }
  write_all("\"", 1);
}

/*
 * Resolve a 1-based line to byte offsets by reading `file`. On success,
 * *start is the first byte of the line and *end is the offset of the
 * terminating newline (or EOF); an empty line still gets end = start + 1.
 * Falls back to zeros when the path is missing or unreadable.
 */
static void span_from_line(const char *file, int64_t line, int64_t *start, int64_t *end) {
  *start = 0;
  *end = 0;
  if (file == NULL || file[0] == '\0' || line <= 0) {
    return;
  }
  int fd = open(file, O_RDONLY);
  if (fd < 0) {
    return;
  }
  int64_t want = line;
  int64_t cur_line = 1;
  int64_t off = 0;
  int64_t line_start = 0;
  char buf[4096];
  for (;;) {
    ssize_t n = read(fd, buf, sizeof(buf));
    if (n <= 0) {
      break;
    }
    for (ssize_t i = 0; i < n; i++) {
      if (buf[i] == '\n') {
        if (cur_line == want) {
          *start = line_start;
          *end = off + (int64_t)i;
          if (*end <= *start) {
            *end = *start + 1;
          }
          close(fd);
          return;
        }
        cur_line++;
        line_start = off + (int64_t)i + 1;
      }
    }
    off += (int64_t)n;
  }
  if (cur_line == want) {
    *start = line_start;
    *end = off > line_start ? off : line_start + 1;
  }
  close(fd);
}

static void write_json_span(const char *file, int64_t line) {
  int64_t start = 0;
  int64_t end = 0;
  int64_t use_line = line > 0 ? line : 1;
  span_from_line(file, use_line, &start, &end);
  write_str("{\"start\":");
  write_i64(start);
  write_str(",\"end\":");
  write_i64(end);
  write_str(",\"line\":");
  write_i64(use_line);
  write_str(",\"column\":1}");
}

static void write_json_frame(const char *file, int64_t line) {
  write_str("{\"path\":");
  write_json_str(file != NULL ? file : "");
  write_str(",\"span\":");
  write_json_span(file, line);
  write_all("}", 1);
}

static void write_json_panic(const char *file, int64_t line, const char *message) {
  write_str("{\"kind\":\"panic\",\"message\":");
  write_json_str(message != NULL ? message : "");
  write_str(",\"path\":");
  write_json_str(file != NULL ? file : "");
  write_str(",\"span\":");
  write_json_span(file, line);
  write_str(",\"frames\":[");
  int first = 1;
  for (int i = mn_trace_len - 1; i >= 0; i--) {
    if (!first) {
      write_all(",", 1);
    }
    first = 0;
    write_json_frame(mn_trace[i].file, mn_trace[i].line);
  }
  write_str("]}\n");
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
  if (json_diag_on()) {
    write_json_panic("", 1, message);
  } else {
    write_str(message);
    write_all("\n", 1);
    write_trace();
  }
  _exit(1);
}

_Noreturn void mn_panic_at(const char *file, int64_t line, const char *message) {
  if (json_diag_on()) {
    write_json_panic(file, line, message);
  } else {
    write_str(file != NULL ? file : "");
    write_all(":", 1);
    write_i64(line);
    write_all(": panic: ", 9);
    write_str(message);
    write_all("\n", 1);
    write_trace();
  }
  _exit(1);
}
