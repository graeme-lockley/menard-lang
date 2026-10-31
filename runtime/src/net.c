/*
 * Parkable TCP/UDP seam (Build F). Non-blocking sockets; completions wake
 * wait cells via mn_net_poll (driven from the task pump / join loop).
 * No Menard on OS worker threads — single mutator.
 */
#include "gc_internal.h"
#include "menard.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define HDR ((int64_t)sizeof(void *))
#define MAX_NET_WAITERS 256
#define TAG_RESULT_ERR 5
#define TAG_IO_OTHER 27

typedef struct MnNetWait {
  int fd;
  short events;
  int cell_id;
  int alive;
} MnNetWait;

static MnNetWait waiters[MAX_NET_WAITERS];

static MnShape shape_io_other = {
    .tag = TAG_IO_OTHER, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

static int64_t str_len(MnWord s) {
  if (mn_is_immediate(s)) {
    mn_panic("mn_net: expected Str");
  }
  return (int64_t)((MnWord *)(uintptr_t)s)[1];
}

static uint8_t *str_bytes(MnWord s) {
  return (uint8_t *)(((MnWord *)(uintptr_t)s) + 2);
}

static char *str_to_cstr(MnWord s) {
  int64_t n = str_len(s);
  char *buf = (char *)malloc((size_t)n + 1);
  if (buf == NULL) {
    mn_panic("mn_net: oom");
  }
  if (n > 0) {
    memcpy(buf, str_bytes(s), (size_t)n);
  }
  buf[n] = '\0';
  return buf;
}

static MnWord io_other(int err) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_io_other);
  obj[1] = mn_int_to_word((int64_t)err);
  return mn_err((MnWord)obj);
}

static MnWord io_err_errno(int err) {
  switch (err) {
  case ENOENT:
    return mn_err((MnWord)&mn_static_not_found);
  case EACCES:
  case EPERM:
    return mn_err((MnWord)&mn_static_permission);
  case EEXIST:
    return mn_err((MnWord)&mn_static_exists);
  default:
    return io_other(err);
  }
}

static int set_nonblock(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags < 0) {
    return -1;
  }
  return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int register_wait(int fd, short events, int cell_id) {
  for (int i = 0; i < MAX_NET_WAITERS; i++) {
    if (!waiters[i].alive) {
      waiters[i].fd = fd;
      waiters[i].events = events;
      waiters[i].cell_id = cell_id;
      waiters[i].alive = 1;
      return 0;
    }
  }
  return -1;
}

static void clear_wait_cell(int cell_id) {
  for (int i = 0; i < MAX_NET_WAITERS; i++) {
    if (waiters[i].alive && waiters[i].cell_id == cell_id) {
      waiters[i].alive = 0;
    }
  }
}

int mn_net_poll(int timeout_ms) {
  struct pollfd pfds[MAX_NET_WAITERS];
  int map[MAX_NET_WAITERS];
  int n = 0;
  for (int i = 0; i < MAX_NET_WAITERS; i++) {
    if (!waiters[i].alive) {
      continue;
    }
    pfds[n].fd = waiters[i].fd;
    pfds[n].events = waiters[i].events;
    pfds[n].revents = 0;
    map[n] = i;
    n++;
  }
  if (n == 0) {
    /* No FDs: still honour a finite timeout so timers can sleep. */
    if (timeout_ms > 0) {
      struct timespec ts;
      ts.tv_sec = (time_t)(timeout_ms / 1000);
      ts.tv_nsec = (long)(timeout_ms % 1000) * 1000000L;
      nanosleep(&ts, NULL);
    }
    return 0;
  }
  int pr = poll(pfds, (nfds_t)n, timeout_ms);
  if (pr <= 0) {
    return 0;
  }
  int notified = 0;
  for (int j = 0; j < n; j++) {
    if (pfds[j].revents == 0) {
      continue;
    }
    int i = map[j];
    int cell = waiters[i].cell_id;
    waiters[i].alive = 0;
    mn_task_notify(mn_int_to_word((int64_t)cell));
    notified++;
  }
  return notified;
}

static int wait_is_err(MnWord result) {
  return mn_tag(result) == TAG_RESULT_ERR;
}

/* Park until fd ready. deadline_mono < 0 = forever.
 * Returns MN_EMPTY to retry, or Err Result on cancel/timeout/fail. */
MnWord mn_park_fd(int fd, short events, int64_t deadline_mono) {
  MnWord cell = mn_task_wait_new();
  int cid = (int)mn_word_to_int(cell);
  if (register_wait(fd, events, cid) != 0) {
    return io_other(ENOMEM);
  }
  MnWord w;
  if (deadline_mono < 0) {
    w = mn_task_wait(cell);
  } else {
    w = mn_task_wait_until(cell, mn_int_to_word(deadline_mono));
  }
  clear_wait_cell(cid);
  if (!wait_is_err(w)) {
    return MN_EMPTY;
  }
  if (deadline_mono >= 0) {
    MnWord e = mn_slot(w, 0);
    if (mn_is_immediate(e) && mn_word_to_int(e) == 1) {
      return mn_err((MnWord)&mn_static_timeout);
    }
  }
  return io_other(-1); /* cancelled */
}

static MnWord park_io(int fd, short events) {
  return mn_park_fd(fd, events, -1);
}

static MnWord park_io_until(int fd, short events, int64_t deadline_mono) {
  return mn_park_fd(fd, events, deadline_mono);
}

MnWord mn_tcp_listen(MnWord port_tagged) {
  int port = (int)mn_word_to_int(port_tagged);
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    return io_err_errno(errno);
  }
  int yes = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
  if (set_nonblock(fd) != 0) {
    int e = errno;
    close(fd);
    return io_err_errno(e);
  }
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  addr.sin_port = htons((uint16_t)port);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    int e = errno;
    close(fd);
    return io_err_errno(e);
  }
  if (listen(fd, 128) != 0) {
    int e = errno;
    close(fd);
    return io_err_errno(e);
  }
  return mn_ok(mn_int_to_word((int64_t)fd));
}

static MnWord tcp_accept_deadline(int lfd, int64_t deadline_mono) {
  for (;;) {
    int cfd = accept(lfd, NULL, NULL);
    if (cfd >= 0) {
      set_nonblock(cfd);
      return mn_ok(mn_int_to_word((int64_t)cfd));
    }
    if (errno == EINTR) {
      continue;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      MnWord p = park_io_until(lfd, POLLIN, deadline_mono);
      if (p != MN_EMPTY) {
        return p;
      }
      continue;
    }
    return io_err_errno(errno);
  }
}

MnWord mn_tcp_accept(MnWord fd_tagged) {
  return tcp_accept_deadline((int)mn_word_to_int(fd_tagged), -1);
}

MnWord mn_tcp_accept_timeout(MnWord fd_tagged, MnWord ms_tagged) {
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tcp_accept_deadline((int)mn_word_to_int(fd_tagged), mn_mono_now_ms() + ms);
}

static MnWord tcp_connect_deadline(MnWord host_str, int port, int64_t deadline_mono) {
  char *host = str_to_cstr(host_str);
  char portbuf[16];
  snprintf(portbuf, sizeof(portbuf), "%d", port);
  struct addrinfo hints;
  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  struct addrinfo *res = NULL;
  int gai = getaddrinfo(host, portbuf, &hints, &res);
  free(host);
  if (gai != 0 || res == NULL) {
    return io_other(EHOSTUNREACH);
  }
  int fd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
  if (fd < 0) {
    int e = errno;
    freeaddrinfo(res);
    return io_err_errno(e);
  }
  set_nonblock(fd);
  int rc = connect(fd, res->ai_addr, res->ai_addrlen);
  freeaddrinfo(res);
  if (rc == 0) {
    return mn_ok(mn_int_to_word((int64_t)fd));
  }
  if (errno != EINPROGRESS) {
    int e = errno;
    close(fd);
    return io_err_errno(e);
  }
  for (;;) {
    MnWord p = park_io_until(fd, POLLOUT, deadline_mono);
    if (p != MN_EMPTY) {
      close(fd);
      return p;
    }
    int soerr = 0;
    socklen_t sl = sizeof(soerr);
    if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &sl) != 0) {
      int e = errno;
      close(fd);
      return io_err_errno(e);
    }
    if (soerr == 0) {
      return mn_ok(mn_int_to_word((int64_t)fd));
    }
    close(fd);
    return io_err_errno(soerr);
  }
}

MnWord mn_tcp_connect(MnWord host_str, MnWord port_tagged) {
  return tcp_connect_deadline(host_str, (int)mn_word_to_int(port_tagged), -1);
}

MnWord mn_tcp_connect_timeout(MnWord host_str, MnWord port_tagged, MnWord ms_tagged) {
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tcp_connect_deadline(host_str, (int)mn_word_to_int(port_tagged),
                              mn_mono_now_ms() + ms);
}

static MnWord tcp_read_deadline(int fd, int64_t max, int64_t deadline_mono) {
  if (max <= 0) {
    max = 4096;
  }
  if (max > 1024 * 1024) {
    max = 1024 * 1024;
  }
  char *buf = (char *)malloc((size_t)max);
  if (buf == NULL) {
    return io_other(ENOMEM);
  }
  for (;;) {
    ssize_t n = recv(fd, buf, (size_t)max, 0);
    if (n > 0) {
      MnWord s = mn_str_new((int64_t)(uintptr_t)buf, (int64_t)n);
      free(buf);
      return mn_ok(s);
    }
    if (n == 0) {
      free(buf);
      return mn_ok(mn_str_new((int64_t)(uintptr_t)"", 0));
    }
    if (errno == EINTR) {
      continue;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      MnWord p = park_io_until(fd, POLLIN, deadline_mono);
      if (p != MN_EMPTY) {
        free(buf);
        return p;
      }
      continue;
    }
    int e = errno;
    free(buf);
    return io_err_errno(e);
  }
}

MnWord mn_tcp_read(MnWord fd_tagged, MnWord max_tagged) {
  return tcp_read_deadline((int)mn_word_to_int(fd_tagged), mn_word_to_int(max_tagged), -1);
}

MnWord mn_tcp_read_timeout(MnWord fd_tagged, MnWord max_tagged, MnWord ms_tagged) {
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tcp_read_deadline((int)mn_word_to_int(fd_tagged), mn_word_to_int(max_tagged),
                           mn_mono_now_ms() + ms);
}

static MnWord tcp_write_deadline(int fd, MnWord data, int64_t deadline_mono) {
  size_t n = (size_t)str_len(data);
  size_t off = 0;
  uint8_t *bytes = str_bytes(data);
  while (off < n) {
    ssize_t w = send(fd, bytes + off, n - off, 0);
    if (w > 0) {
      off += (size_t)w;
      continue;
    }
    if (w < 0 && errno == EINTR) {
      continue;
    }
    if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
      MnWord p = park_io_until(fd, POLLOUT, deadline_mono);
      if (p != MN_EMPTY) {
        return p;
      }
      continue;
    }
    return io_err_errno(errno);
  }
  return mn_ok(MN_UNIT);
}

MnWord mn_tcp_write(MnWord fd_tagged, MnWord data) {
  return tcp_write_deadline((int)mn_word_to_int(fd_tagged), data, -1);
}

MnWord mn_tcp_write_timeout(MnWord fd_tagged, MnWord data, MnWord ms_tagged) {
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tcp_write_deadline((int)mn_word_to_int(fd_tagged), data, mn_mono_now_ms() + ms);
}

MnWord mn_tcp_close(MnWord fd_tagged) {
  int fd = (int)mn_word_to_int(fd_tagged);
  if (fd >= 0) {
    close(fd);
  }
  return MN_UNIT;
}

/* Bound TCP port for a listening (or connected) socket — enables listen(0). */
MnWord mn_tcp_local_port(MnWord fd_tagged) {
  int fd = (int)mn_word_to_int(fd_tagged);
  struct sockaddr_in addr;
  socklen_t len = sizeof(addr);
  memset(&addr, 0, sizeof(addr));
  if (getsockname(fd, (struct sockaddr *)&addr, &len) != 0) {
    return io_err_errno(errno);
  }
  if (addr.sin_family != AF_INET) {
    return io_other(EINVAL);
  }
  return mn_ok(mn_int_to_word((int64_t)ntohs(addr.sin_port)));
}

MnWord mn_udp_bind(MnWord port_tagged) {
  int port = (int)mn_word_to_int(port_tagged);
  int fd = socket(AF_INET, SOCK_DGRAM, 0);
  if (fd < 0) {
    return io_err_errno(errno);
  }
  int yes = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
  set_nonblock(fd);
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  addr.sin_port = htons((uint16_t)port);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    int e = errno;
    close(fd);
    return io_err_errno(e);
  }
  return mn_ok(mn_int_to_word((int64_t)fd));
}

MnWord mn_udp_send(MnWord fd_tagged, MnWord host_str, MnWord port_tagged, MnWord data) {
  int fd = (int)mn_word_to_int(fd_tagged);
  char *host = str_to_cstr(host_str);
  int port = (int)mn_word_to_int(port_tagged);
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)port);
  if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
    free(host);
    return io_other(EINVAL);
  }
  free(host);
  size_t n = (size_t)str_len(data);
  for (;;) {
    ssize_t w = sendto(fd, str_bytes(data), n, 0, (struct sockaddr *)&addr, sizeof(addr));
    if (w >= 0) {
      return mn_ok(MN_UNIT);
    }
    if (errno == EINTR) {
      continue;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      MnWord p = park_io(fd, POLLOUT);
      if (p != MN_EMPTY) {
        return p;
      }
      continue;
    }
    return io_err_errno(errno);
  }
}

MnWord mn_udp_recv(MnWord fd_tagged, MnWord max_tagged) {
  int fd = (int)mn_word_to_int(fd_tagged);
  int64_t max = mn_word_to_int(max_tagged);
  if (max <= 0) {
    max = 4096;
  }
  char *buf = (char *)malloc((size_t)max);
  if (buf == NULL) {
    return io_other(ENOMEM);
  }
  for (;;) {
    ssize_t n = recvfrom(fd, buf, (size_t)max, 0, NULL, NULL);
    if (n >= 0) {
      MnWord s = mn_str_new((int64_t)(uintptr_t)buf, (int64_t)n);
      free(buf);
      return mn_ok(s);
    }
    if (errno == EINTR) {
      continue;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      MnWord p = park_io(fd, POLLIN);
      if (p != MN_EMPTY) {
        free(buf);
        return p;
      }
      continue;
    }
    int e = errno;
    free(buf);
    return io_err_errno(e);
  }
}

MnWord mn_udp_close(MnWord fd_tagged) {
  return mn_tcp_close(fd_tagged);
}
