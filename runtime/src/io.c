/*
 * Tier-0 I/O seam (Phase 3 slice G): argv, read-file, write-file, exit.
 *
 * `mn_init` stores process argv once at startup (emitted `@main` calls it
 * with the C `main(argc, argv)` parameters). File helpers return Menard
 * `(Result … IoError)` words built with `mn_ok` / `mn_err`.
 */
#include "menard.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define HDR ((int64_t)sizeof(void *))

/* IoError constructor tags — distinct from List/Maybe/Result (0–5). */
#define TAG_IO_NOT_FOUND 20
#define TAG_IO_PERMISSION 21
#define TAG_IO_EXISTS 22
#define TAG_IO_IS_A_DIRECTORY 23
#define TAG_IO_NOT_A_DIRECTORY 24
#define TAG_IO_INVALID_PATH 25
#define TAG_IO_TOO_LARGE 26
#define TAG_IO_OTHER 27

static MnShape shape_io_not_found = {
    .tag = TAG_IO_NOT_FOUND, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_io_permission = {
    .tag = TAG_IO_PERMISSION, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_io_exists = {
    .tag = TAG_IO_EXISTS, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_io_is_a_directory = {
    .tag = TAG_IO_IS_A_DIRECTORY, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_io_not_a_directory = {
    .tag = TAG_IO_NOT_A_DIRECTORY, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_io_invalid_path = {
    .tag = TAG_IO_INVALID_PATH, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_io_too_large = {
    .tag = TAG_IO_TOO_LARGE, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_io_other = {
    .tag = TAG_IO_OTHER, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

static struct {
  MnShape *shape;
} static_not_found = {.shape = &shape_io_not_found};
static struct {
  MnShape *shape;
} static_permission = {.shape = &shape_io_permission};
static struct {
  MnShape *shape;
} static_exists = {.shape = &shape_io_exists};
static struct {
  MnShape *shape;
} static_is_a_directory = {.shape = &shape_io_is_a_directory};
static struct {
  MnShape *shape;
} static_not_a_directory = {.shape = &shape_io_not_a_directory};
static struct {
  MnShape *shape;
} static_invalid_path = {.shape = &shape_io_invalid_path};
static struct {
  MnShape *shape;
} static_too_large = {.shape = &shape_io_too_large};

static int g_argc = 0;
static char **g_argv = NULL;

void mn_init(int argc, char **argv) {
  g_argc = argc;
  g_argv = argv;
}

MnWord mn_arg_count(void) { return mn_int_to_word((int64_t)g_argc); }

static int64_t str_len(MnWord s) {
  if (mn_is_immediate(s)) {
    mn_panic("mn_io: expected Str object");
  }
  return (int64_t)((MnWord *)(uintptr_t)s)[1];
}

static uint8_t *str_bytes(MnWord s) {
  return (uint8_t *)(((MnWord *)(uintptr_t)s) + 2);
}

/* NUL-terminated copy for libc; caller frees. Empty path → "". */
static char *str_to_cstr(MnWord s) {
  int64_t n = str_len(s);
  char *buf = (char *)malloc((size_t)n + 1);
  if (buf == NULL) {
    mn_panic("mn_io: out of memory");
  }
  if (n > 0) {
    memcpy(buf, str_bytes(s), (size_t)n);
  }
  buf[n] = '\0';
  return buf;
}

MnWord mn_arg(MnWord i_tagged) {
  int64_t i = mn_word_to_int(i_tagged);
  if (i < 0 || i >= (int64_t)g_argc || g_argv == NULL) {
    mn_panic("mn_arg: index out of range");
  }
  const char *a = g_argv[i];
  int64_t n = (int64_t)strlen(a);
  return mn_str_new((int64_t)(uintptr_t)a, n);
}

static MnWord io_err_from_errno(int err) {
  switch (err) {
  case ENOENT:
    return (MnWord)&static_not_found;
  case EACCES:
  case EPERM:
    return (MnWord)&static_permission;
  case EEXIST:
    return (MnWord)&static_exists;
  case EISDIR:
    return (MnWord)&static_is_a_directory;
  case ENOTDIR:
    return (MnWord)&static_not_a_directory;
  case ENAMETOOLONG:
    return (MnWord)&static_invalid_path;
  case EFBIG:
    return (MnWord)&static_too_large;
  default: {
    MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_io_other);
    obj[1] = mn_int_to_word((int64_t)err);
    return (MnWord)obj;
  }
  }
}

MnWord mn_read_file(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  FILE *f = fopen(path, "rb");
  free(path);
  if (f == NULL) {
    return mn_err(io_err_from_errno(errno));
  }
  if (fseek(f, 0, SEEK_END) != 0) {
    int e = errno;
    fclose(f);
    return mn_err(io_err_from_errno(e));
  }
  long sz = ftell(f);
  if (sz < 0) {
    int e = errno;
    fclose(f);
    return mn_err(io_err_from_errno(e));
  }
  if (fseek(f, 0, SEEK_SET) != 0) {
    int e = errno;
    fclose(f);
    return mn_err(io_err_from_errno(e));
  }
  uint8_t *buf = NULL;
  if (sz > 0) {
    buf = (uint8_t *)malloc((size_t)sz);
    if (buf == NULL) {
      fclose(f);
      mn_panic("mn_read_file: out of memory");
    }
    size_t got = fread(buf, 1, (size_t)sz, f);
    if (got != (size_t)sz) {
      int e = ferror(f) ? errno : EIO;
      free(buf);
      fclose(f);
      return mn_err(io_err_from_errno(e));
    }
  }
  fclose(f);
  MnWord s = mn_str_new((int64_t)(uintptr_t)buf, (int64_t)sz);
  free(buf);
  return mn_ok(s);
}

MnWord mn_write_file(MnWord path_str, MnWord content_str) {
  char *path = str_to_cstr(path_str);
  FILE *f = fopen(path, "wb");
  free(path);
  if (f == NULL) {
    return mn_err(io_err_from_errno(errno));
  }
  int64_t n = str_len(content_str);
  if (n > 0) {
    size_t wrote = fwrite(str_bytes(content_str), 1, (size_t)n, f);
    if (wrote != (size_t)n) {
      int e = errno;
      fclose(f);
      return mn_err(io_err_from_errno(e));
    }
  }
  if (fclose(f) != 0) {
    return mn_err(io_err_from_errno(errno));
  }
  return mn_ok(MN_UNIT);
}

_Noreturn void mn_exit(MnWord code_tagged) {
  int code = (int)(mn_word_to_int(code_tagged) & (int64_t)0xff);
  _exit(code);
}
