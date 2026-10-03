/*
 * Tier-0 I/O seam (Phase 3 slice G): argv, read-file, write-file, exit.
 *
 * `mn_init` stores process argv once at startup (emitted `@main` calls it
 * with the C `main(argc, argv)` parameters). File helpers return Menard
 * `(Result … IoError)` words built with `mn_ok` / `mn_err`.
 */
#include "menard.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
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
    .tag = TAG_IO_NOT_FOUND, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_io_permission = {
    .tag = TAG_IO_PERMISSION, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_io_exists = {
    .tag = TAG_IO_EXISTS, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_io_is_a_directory = {
    .tag = TAG_IO_IS_A_DIRECTORY, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_io_not_a_directory = {
    .tag = TAG_IO_NOT_A_DIRECTORY, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_io_invalid_path = {
    .tag = TAG_IO_INVALID_PATH, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_io_too_large = {
    .tag = TAG_IO_TOO_LARGE, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_io_other = {
    .tag = TAG_IO_OTHER, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_not_found = {.shape = &shape_io_not_found};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_permission = {.shape = &shape_io_permission};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_exists = {.shape = &shape_io_exists};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_is_a_directory = {.shape = &shape_io_is_a_directory};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_not_a_directory = {.shape = &shape_io_not_a_directory};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_invalid_path = {.shape = &shape_io_invalid_path};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_too_large = {.shape = &shape_io_too_large};

static int g_argc = 0;
static char **g_argv = NULL;
extern char **environ;

void mn_init(int argc, char **argv) {
  /* `(arg 0)` is the first user argument, matching the interpreter
   * (host argv is the slice after `--`, not the process name). */
  if (argc > 0 && argv != NULL) {
    g_argc = argc - 1;
    g_argv = argv + 1;
  } else {
    g_argc = 0;
    g_argv = argv;
  }
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
  /* `_exit` skips atexit, so a compiler-sized run still reports pauses. */
  if (getenv("MENARD_GC_STATS") != NULL) {
    mn_gc_stats();
  }
  _exit(code);
}

/* SpawnStatus tags — distinct from List/Maybe/Result (0–5) and IoError (20–27). */
#define TAG_EXITED 30
#define TAG_SIGNALLED 31

static MnShape shape_exited = {.tag = TAG_EXITED, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_signalled = {.tag = TAG_SIGNALLED, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

static MnWord make_exited(int code) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_exited);
  obj[1] = mn_int_to_word((int64_t)(code & 0xff));
  return (MnWord)obj;
}

static MnWord make_signalled(int sig) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_signalled);
  obj[1] = mn_int_to_word((int64_t)sig);
  return (MnWord)obj;
}

/* `(List Str)` is Nil/Cons. No PATH search: posix_spawn, not posix_spawnp.
   A suite link passes one object per module plus the runtime sources. */
#define SPAWN_MAX 512

/* SpawnError tags that are not also IoError. SpawnOutput is the record. */
#define TAG_SPAWN_OUTPUT 32
#define TAG_NOT_EXECUTABLE 33
#define TAG_INVALID_ARGUMENT 34
#define TAG_TOO_MANY_ARGUMENTS 35

static MnShape shape_not_executable = {
    .tag = TAG_NOT_EXECUTABLE, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_invalid_argument = {
    .tag = TAG_INVALID_ARGUMENT, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static MnShape shape_too_many_arguments = {
    .tag = TAG_TOO_MANY_ARGUMENTS, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};

static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_not_executable = {.shape = &shape_not_executable};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_invalid_argument = {.shape = &shape_invalid_argument};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) static_too_many_arguments = {.shape = &shape_too_many_arguments};

enum { ARG_OK = 0, ARG_BAD = 1, ARG_TOO_MANY = 2 };

static int list_is_nil(MnWord xs);
static int append_arg(char **argv, int n, MnWord s);

static void free_argv(char **argv, int n) {
  for (int i = 0; i < n; i++) {
    free(argv[i]);
  }
}

/* Bare names are `./name`, matching the host. A path (slash or backslash) is kept. */
static int prefix_dot_slash(char **cmd) {
  const char *s = *cmd;
  for (const char *p = s; *p; p++) {
    if (*p == '/' || *p == '\\') {
      return 0;
    }
  }
  size_t n = strlen(s);
  char *buf = (char *)malloc(n + 3);
  if (buf == NULL) {
    mn_panic("mn_spawn_capture: out of memory");
  }
  buf[0] = '.';
  buf[1] = '/';
  memcpy(buf + 2, s, n + 1);
  free(*cmd);
  *cmd = buf;
  return 0;
}

static int fill_spawn_argv(MnWord argv_list, char **argv, int *n_out) {
  int n = 0;
  MnWord xs = argv_list;
  while (!list_is_nil(xs)) {
    if (mn_tag(xs) != 1) {
      free_argv(argv, n);
      return ARG_BAD;
    }
    if (n >= SPAWN_MAX) {
      free_argv(argv, n);
      return ARG_TOO_MANY;
    }
    if (append_arg(argv, n, mn_slot(xs, 0)) != 0) {
      free_argv(argv, n);
      return ARG_BAD;
    }
    n++;
    xs = mn_slot(xs, 1);
  }
  if (n == 0) {
    return ARG_BAD;
  }
  argv[n] = NULL;
  *n_out = n;
  return ARG_OK;
}

static MnWord spawn_errno_err(int rc) {
  if (rc == ENOENT) {
    return mn_err((MnWord)&static_not_found);
  }
  if (rc == EACCES || rc == EPERM) {
    return mn_err((MnWord)&static_permission);
  }
  if (rc == ENOEXEC) {
    return mn_err((MnWord)&static_not_executable);
  }
  if (rc == E2BIG) {
    return mn_err((MnWord)&static_too_many_arguments);
  }
  /* Host `mapSpawnErrno` folds every other code to NotFound. */
  return mn_err((MnWord)&static_not_found);
}

static int list_is_nil(MnWord xs) { return mn_tag(xs) == 0; }

static int append_arg(char **argv, int n, MnWord s) {
  int64_t len = str_len(s);
  const uint8_t *p = str_bytes(s);
  for (int64_t i = 0; i < len; i++) {
    if (p[i] == 0) {
      return -1;
    }
  }
  char *buf = (char *)malloc((size_t)len + 1);
  if (buf == NULL) {
    mn_panic("mn_spawn: out of memory");
  }
  if (len > 0) {
    memcpy(buf, p, (size_t)len);
  }
  buf[len] = '\0';
  argv[n] = buf;
  return 0;
}

MnWord mn_spawn(MnWord argv_list) {
  char *argv[SPAWN_MAX + 1];
  int n = 0;
  int built = fill_spawn_argv(argv_list, argv, &n);
  if (built == ARG_BAD) {
    return mn_err((MnWord)&static_invalid_path);
  }
  if (built == ARG_TOO_MANY) {
    return mn_err((MnWord)&static_too_large);
  }
  pid_t pid = 0;
  int rc = posix_spawn(&pid, argv[0], NULL, NULL, argv, environ);
  free_argv(argv, n);
  if (rc != 0) {
    return mn_err(io_err_from_errno(rc));
  }
  int st = 0;
  if (waitpid(pid, &st, 0) < 0) {
    return mn_err(io_err_from_errno(errno));
  }
  if (WIFSIGNALED(st)) {
    return mn_ok(make_signalled(WTERMSIG(st)));
  }
  int code = WIFEXITED(st) ? WEXITSTATUS(st) : 1;
  return mn_ok(make_exited(code));
}

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} ByteBuf;

static void buf_append(ByteBuf *b, const char *p, size_t n) {
  if (b->len + n > b->cap) {
    size_t cap = b->cap == 0 ? 4096 : b->cap;
    while (cap < b->len + n) {
      cap *= 2;
    }
    char *next = (char *)realloc(b->data, cap);
    if (next == NULL) {
      mn_panic("mn_spawn_capture: out of memory");
    }
    b->data = next;
    b->cap = cap;
  }
  if (n > 0) {
    memcpy(b->data + b->len, p, n);
  }
  b->len += n;
}

static void set_nonblock(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags >= 0) {
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
  }
}

/* Read until EAGAIN or EOF. EOF clears *open_flag and closes fd. */
static void pump_fd(int fd, ByteBuf *b, int *open_flag) {
  char tmp[4096];
  for (;;) {
    ssize_t k = read(fd, tmp, sizeof tmp);
    if (k > 0) {
      buf_append(b, tmp, (size_t)k);
      continue;
    }
    if (k == 0) {
      *open_flag = 0;
      close(fd);
      return;
    }
    if (errno == EINTR) {
      continue;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      return;
    }
    *open_flag = 0;
    close(fd);
    return;
  }
}

MnWord mn_spawn_capture(MnWord argv_list, MnWord stdin_str) {
  if (mn_is_immediate(stdin_str)) {
    mn_panic("mn_spawn_capture: expected Str");
  }
  char *argv[SPAWN_MAX + 1];
  int n = 0;
  int built = fill_spawn_argv(argv_list, argv, &n);
  if (built == ARG_BAD) {
    return mn_err((MnWord)&static_invalid_argument);
  }
  if (built == ARG_TOO_MANY) {
    return mn_err((MnWord)&static_too_many_arguments);
  }
  prefix_dot_slash(&argv[0]);

  int in_pipe[2];
  int out_pipe[2];
  int err_pipe[2];
  if (pipe(in_pipe) != 0 || pipe(out_pipe) != 0 || pipe(err_pipe) != 0) {
    free_argv(argv, n);
    return mn_err((MnWord)&static_not_found);
  }

  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, in_pipe[0], STDIN_FILENO);
  posix_spawn_file_actions_adddup2(&actions, out_pipe[1], STDOUT_FILENO);
  posix_spawn_file_actions_adddup2(&actions, err_pipe[1], STDERR_FILENO);
  posix_spawn_file_actions_addclose(&actions, in_pipe[0]);
  posix_spawn_file_actions_addclose(&actions, in_pipe[1]);
  posix_spawn_file_actions_addclose(&actions, out_pipe[0]);
  posix_spawn_file_actions_addclose(&actions, out_pipe[1]);
  posix_spawn_file_actions_addclose(&actions, err_pipe[0]);
  posix_spawn_file_actions_addclose(&actions, err_pipe[1]);

  pid_t pid = 0;
  int rc = posix_spawn(&pid, argv[0], &actions, NULL, argv, environ);
  posix_spawn_file_actions_destroy(&actions);
  free_argv(argv, n);
  close(in_pipe[0]);
  close(out_pipe[1]);
  close(err_pipe[1]);
  if (rc != 0) {
    close(in_pipe[1]);
    close(out_pipe[0]);
    close(err_pipe[0]);
    return spawn_errno_err(rc);
  }

  set_nonblock(in_pipe[1]);
  set_nonblock(out_pipe[0]);
  set_nonblock(err_pipe[0]);

  const uint8_t *in_bytes = str_bytes(stdin_str);
  int64_t in_len = str_len(stdin_str);
  int64_t in_off = 0;
  int stdin_fd = in_pipe[1];
  if (in_len == 0) {
    close(stdin_fd);
    stdin_fd = -1;
  }
  int out_open = 1;
  int err_open = 1;
  ByteBuf out_buf = {NULL, 0, 0};
  ByteBuf err_buf = {NULL, 0, 0};

  while (out_open || err_open || in_off < in_len) {
    struct pollfd fds[3];
    nfds_t nf = 0;
    int in_i = -1;
    int out_i = -1;
    int err_i = -1;
    if (in_off < in_len) {
      in_i = (int)nf;
      fds[nf].fd = stdin_fd;
      fds[nf].events = POLLOUT;
      fds[nf].revents = 0;
      nf++;
    }
    if (out_open) {
      out_i = (int)nf;
      fds[nf].fd = out_pipe[0];
      fds[nf].events = POLLIN;
      fds[nf].revents = 0;
      nf++;
    }
    if (err_open) {
      err_i = (int)nf;
      fds[nf].fd = err_pipe[0];
      fds[nf].events = POLLIN;
      fds[nf].revents = 0;
      nf++;
    }
    if (nf == 0) {
      break;
    }
    int polled = poll(fds, nf, -1);
    if (polled < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }
    if (in_i >= 0 && (fds[in_i].revents & (POLLOUT | POLLERR | POLLHUP)) != 0) {
      ssize_t wrote = write(stdin_fd, in_bytes + in_off, (size_t)(in_len - in_off));
      if (wrote > 0) {
        in_off += wrote;
      } else if (wrote < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
        in_off = in_len;
      }
      if (in_off >= in_len && stdin_fd >= 0) {
        close(stdin_fd);
        stdin_fd = -1;
      }
    }
    if (out_i >= 0 && (fds[out_i].revents & (POLLIN | POLLHUP | POLLERR)) != 0) {
      pump_fd(out_pipe[0], &out_buf, &out_open);
    }
    if (err_i >= 0 && (fds[err_i].revents & (POLLIN | POLLHUP | POLLERR)) != 0) {
      pump_fd(err_pipe[0], &err_buf, &err_open);
    }
  }
  if (stdin_fd >= 0) {
    close(stdin_fd);
  }
  if (out_open) {
    close(out_pipe[0]);
  }
  if (err_open) {
    close(err_pipe[0]);
  }

  int wst = 0;
  if (waitpid(pid, &wst, 0) < 0) {
    free(out_buf.data);
    free(err_buf.data);
    return spawn_errno_err(errno);
  }

  MnWord out_s = MN_EMPTY;
  MnWord err_s = MN_EMPTY;
  MnWord status = MN_EMPTY;
  MnWord rec = MN_EMPTY;
  mn_root_push(&out_s);
  mn_root_push(&err_s);
  mn_root_push(&status);
  mn_root_push(&rec);
  out_s = mn_str_new((int64_t)(uintptr_t)out_buf.data, (int64_t)out_buf.len);
  err_s = mn_str_new((int64_t)(uintptr_t)err_buf.data, (int64_t)err_buf.len);
  free(out_buf.data);
  free(err_buf.data);
  if (WIFSIGNALED(wst)) {
    status = make_signalled(WTERMSIG(wst));
  } else {
    int code = WIFEXITED(wst) ? WEXITSTATUS(wst) : 1;
    status = make_exited(code);
  }
  rec = mn_new((int64_t)TAG_SPAWN_OUTPUT, 3);
  mn_set_slot(rec, 0, status);
  mn_set_slot(rec, 1, out_s);
  mn_set_slot(rec, 2, err_s);
  MnWord ok = mn_ok(rec);
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
  return ok;
}

MnWord mn_getenv(MnWord name) {
  char *n = str_to_cstr(name);
  const char *v = getenv(n);
  free(n);
  if (v == NULL) {
    return mn_none();
  }
  return mn_some(mn_str_new((int64_t)(uintptr_t)v, (int64_t)strlen(v)));
}

MnWord mn_exists(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  struct stat st;
  int rc = stat(path, &st);
  free(path);
  return rc == 0 ? MN_TRUE : MN_FALSE;
}

MnWord mn_rename(MnWord from_str, MnWord to_str) {
  char *from = str_to_cstr(from_str);
  char *to = str_to_cstr(to_str);
  int rc = rename(from, to);
  int err = errno;
  free(from);
  free(to);
  if (rc != 0) {
    return mn_err(io_err_from_errno(err));
  }
  return mn_ok(MN_UNIT);
}

MnWord mn_isatty(MnWord fd_tagged) {
  int fd = (int)mn_word_to_int(fd_tagged);
  return isatty(fd) ? MN_TRUE : MN_FALSE;
}

static int64_t mtime_ms(const struct stat *st) {
#if defined(__APPLE__)
  return (int64_t)st->st_mtimespec.tv_sec * 1000 +
         (int64_t)st->st_mtimespec.tv_nsec / 1000000;
#else
  return (int64_t)st->st_mtim.tv_sec * 1000 + (int64_t)st->st_mtim.tv_nsec / 1000000;
#endif
}

MnWord mn_mtime(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  struct stat st;
  int rc = stat(path, &st);
  free(path);
  if (rc != 0) {
    return mn_int_to_word(0);
  }
  return mn_int_to_word(mtime_ms(&st));
}

MnWord mn_cwd(void) {
  char buf[PATH_MAX];
  if (getcwd(buf, sizeof buf) == NULL) {
    return mn_str_new(0, 0);
  }
  return mn_str_new((int64_t)(uintptr_t)buf, (int64_t)strlen(buf));
}

static int mkdir_one(const char *path) {
  if (mkdir(path, 0755) == 0 || errno == EEXIST) {
    return 1;
  }
  return 0;
}

MnWord mn_ensure_dir(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  size_t n = strlen(path);
  int ok = 1;
  size_t i;
  for (i = 1; i < n; i++) {
    if (path[i] == '/') {
      path[i] = '\0';
      if (!mkdir_one(path)) {
        ok = 0;
      }
      path[i] = '/';
    }
  }
  if (n > 0 && path[n - 1] != '/') {
    if (!mkdir_one(path)) {
      ok = 0;
    }
  }
  free(path);
  return ok ? MN_TRUE : MN_FALSE;
}

MnWord mn_list_dir(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  DIR *d = opendir(path);
  free(path);
  if (d == NULL) {
    return mn_str_new(0, 0);
  }
  size_t cap = 256;
  size_t len = 0;
  char *buf = (char *)malloc(cap);
  if (buf == NULL) {
    closedir(d);
    mn_panic("mn_list_dir: out of memory");
  }
  struct dirent *ent;
  int first = 1;
  while ((ent = readdir(d)) != NULL) {
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) {
      continue;
    }
    size_t nl = strlen(ent->d_name);
    size_t extra = first ? 0 : 1;
    size_t need = len + extra + nl + 1;
    if (need > cap) {
      size_t ncap = cap;
      while (ncap < need) {
        ncap *= 2;
      }
      char *nb = (char *)realloc(buf, ncap);
      if (nb == NULL) {
        free(buf);
        closedir(d);
        mn_panic("mn_list_dir: out of memory");
      }
      buf = nb;
      cap = ncap;
    }
    if (!first) {
      buf[len++] = '\n';
    }
    memcpy(buf + len, ent->d_name, nl);
    len += nl;
    first = 0;
  }
  closedir(d);
  MnWord s = mn_str_new((int64_t)(uintptr_t)buf, (int64_t)len);
  free(buf);
  return s;
}

MnWord mn_realpath(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  char *resolved = realpath(path, NULL);
  free(path);
  if (resolved == NULL) {
    return mn_str_new(0, 0);
  }
  MnWord s = mn_str_new((int64_t)(uintptr_t)resolved, (int64_t)strlen(resolved));
  free(resolved);
  return s;
}

MnWord mn_now_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
    return mn_int_to_word(0);
  }
  int64_t ms = (int64_t)ts.tv_sec * 1000 + (int64_t)ts.tv_nsec / 1000000;
  return mn_int_to_word(ms);
}

MnWord mn_remove(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  int rc = unlink(path);
  free(path);
  return rc == 0 ? MN_TRUE : MN_FALSE;
}

MnWord mn_is_dir(MnWord path_str) {
  char *path = str_to_cstr(path_str);
  struct stat st;
  int rc = stat(path, &st);
  free(path);
  if (rc != 0) {
    return MN_FALSE;
  }
  return S_ISDIR(st.st_mode) ? MN_TRUE : MN_FALSE;
}
