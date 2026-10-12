/*
 * StringBuffer versus the collector.
 *
 * A dropped buffer must not leave its backing store behind. Length and
 * capacity are even when stored raw, so a live buffer has to survive
 * heap-verify: those words are tagged immediates, and the bytes live in
 * a separate `bytes` object the collector can actually see.
 *
 * Not linked into a Menard program — it defines main. `make runtime-sb-gc`.
 */
#include "menard.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__APPLE__)
#include <malloc/malloc.h>
static size_t malloc_in_use(void) {
  malloc_statistics_t s;
  malloc_zone_statistics(malloc_default_zone(), &s);
  return s.size_in_use;
}
#elif defined(__linux__)
#include <malloc.h>
static size_t malloc_in_use(void) {
  struct mallinfo2 m = mallinfo2();
  return (size_t)m.uordblks;
}
#else
static size_t malloc_in_use(void) { return 0; }
#endif

static void expect(int cond, const char *msg) {
  if (!cond) {
    mn_panic(msg);
  }
}

static int trace_field(const char *line, const char *key, unsigned long long *out) {
  const char *p = strstr(line, key);
  if (p == NULL) {
    return 0;
  }
  p += strlen(key);
  char *end = NULL;
  unsigned long long v = strtoull(p, &end, 10);
  if (end == p) {
    return 0;
  }
  *out = v;
  return 1;
}

/* MENARD_GC_TRACE is already set by the caller. Check the log it wrote. */
static int trace_selftest(void) {
  const char *path = getenv("MENARD_GC_TRACE_OUT");
  if (path == NULL || path[0] == '\0' || strcmp(path, "stdout") == 0) {
    mn_panic("sb-gc: trace selftest needs MENARD_GC_TRACE_OUT as a file path");
  }
  MnWord sb;
  mn_root_push(&sb);
  sb = mn_sb_new();
  for (int j = 0; j < 64; j++) {
    mn_sb_append_byte(sb, mn_int_to_word('a'));
  }
  mn_root_pop();
  mn_gc_collect();

  FILE *f = fopen(path, "r");
  if (f == NULL) {
    mn_panic("sb-gc: trace file missing");
  }
  char line[256];
  int minors = 0;
  while (fgets(line, sizeof(line), f) != NULL) {
    if (strncmp(line, "gc minor ", 9) != 0 && strncmp(line, "gc major ", 9) != 0) {
      mn_panic("sb-gc: trace line has an unknown kind");
    }
    unsigned long long size = 0;
    unsigned long long freed = 0;
    unsigned long long dur = 0;
    if (!trace_field(line, "size=", &size) || !trace_field(line, "freed=", &freed) ||
        !trace_field(line, "duration_ns=", &dur)) {
      mn_panic("sb-gc: trace line is missing size, freed, or duration");
    }
    if (freed > size) {
      mn_panic("sb-gc: trace freed more than size");
    }
    if (strncmp(line, "gc minor ", 9) == 0 && size > 0) {
      minors++;
    }
  }
  fclose(f);
  if (minors < 1) {
    mn_panic("sb-gc: trace recorded no nursery collection");
  }
  printf("ok\n");
  return 0;
}

static int same_bytes(MnWord s, const char *lit) {
  int64_t n = (int64_t)strlen(lit);
  if (mn_word_to_int(mn_str_byte_length(s)) != n) {
    return 0;
  }
  for (int64_t i = 0; i < n; i++) {
    if (mn_word_to_int(mn_str_byte(s, mn_int_to_word(i))) != (unsigned char)lit[i]) {
      return 0;
    }
  }
  return 1;
}

static void check_semantics(void) {
  MnWord sb;
  MnWord shared;
  MnWord taken;
  mn_root_push(&sb);
  mn_root_push(&shared);
  mn_root_push(&taken);

  sb = mn_sb_new();
  /* Even length and capacity must not be traced as pointers. */
  mn_gc_collect();
  expect(mn_word_to_int(mn_sb_length(sb)) == 0, "sb-gc: new buffer is not empty");

  MnWord hi = mn_str_new((int64_t)(uintptr_t) "hi", 2);
  mn_sb_append(sb, hi);
  shared = mn_sb_to_str(sb);
  mn_sb_append_byte(sb, mn_int_to_word('!'));
  expect(same_bytes(shared, "hi"), "sb-gc: append mutated a Str from to-str");
  expect(same_bytes(mn_sb_to_str(sb), "hi!"), "sb-gc: append after to-str");

  mn_sb_clear(sb);
  expect(mn_word_to_int(mn_sb_length(sb)) == 0, "sb-gc: clear left bytes");
  expect(same_bytes(shared, "hi"), "sb-gc: clear mutated a Str from to-str");

  mn_sb_append(sb, mn_str_new((int64_t)(uintptr_t) "z", 1));
  taken = mn_sb_take_str(sb);
  expect(same_bytes(taken, "z"), "sb-gc: take-str");
  expect(mn_word_to_int(mn_sb_length(sb)) == 0, "sb-gc: buffer not empty after take-str");
  mn_sb_append_byte(sb, mn_int_to_word('q'));
  expect(same_bytes(taken, "z"), "sb-gc: append mutated a Str from take-str");

  mn_gc_collect();
  expect(same_bytes(shared, "hi"), "sb-gc: to-str payload collected while rooted");
  expect(same_bytes(taken, "z"), "sb-gc: take-str payload collected while rooted");
  expect(mn_word_to_int(mn_sb_length(sb)) == 1, "sb-gc: live buffer lost its length");

  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
}

static void check_dropped_buffers_are_reclaimed(void) {
  int iters = 2000;
  const char *env = getenv("SB_GC_ITERS");
  if (env != NULL && env[0] != '\0') {
    iters = atoi(env);
    if (iters < 1) {
      iters = 1;
    }
  }

  mn_gc_collect();
  size_t base = malloc_in_use();
  for (int i = 0; i < iters; i++) {
    MnWord sb;
    mn_root_push(&sb);
    sb = mn_sb_new();
    for (int j = 0; j < 200; j++) {
      mn_sb_append_byte(sb, mn_int_to_word('a'));
    }
    mn_root_pop();
  }
  mn_gc_collect();
  size_t after = malloc_in_use();
  long delta = (long)after - (long)base;
  if (delta > 64 * 1024) {
    fprintf(stderr, "sb-gc: dropped StringBuffers leaked %ld malloc bytes\n", delta);
    mn_panic("sb-gc: backing store leaked");
  }
}

int main(void) {
  if (getenv("SB_GC_TRACE_SELFTEST") != NULL) {
    return trace_selftest();
  }
  check_semantics();
  check_dropped_buffers_are_reclaimed();
  printf("ok\n");
  return 0;
}
