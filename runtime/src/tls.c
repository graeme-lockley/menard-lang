/*
 * OpenSSL TLS byte-stream seam (Build F). Same backend on all platforms.
 * Wraps an already-connected TCP fd. Cooperative poll on WANT_READ/WRITE.
 */
#include "gc_internal.h"
#include "menard.h"

#include <errno.h>
#include <poll.h>
#include <stdlib.h>
#include <string.h>

#include <openssl/err.h>
#include <openssl/ssl.h>

#define HDR ((int64_t)sizeof(void *))
#define TAG_IO_OTHER 27
#define MAX_TLS 64

typedef struct MnTlsConn {
  SSL *ssl;
  int fd;
  int alive;
} MnTlsConn;

static MnTlsConn conns[MAX_TLS];
static SSL_CTX *client_ctx = NULL;
static SSL_CTX *server_ctx = NULL;
static int openssl_ready = 0;

static MnShape shape_io_other = {
    .tag = TAG_IO_OTHER, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

static MnWord io_other(int err) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_io_other);
  obj[1] = mn_int_to_word((int64_t)err);
  return mn_err((MnWord)obj);
}

static char *word_to_cstr(MnWord s) {
  int64_t n = mn_word_to_int(mn_str_byte_length(s));
  char *buf = (char *)malloc((size_t)n + 1);
  if (buf == NULL) {
    return NULL;
  }
  for (int64_t i = 0; i < n; i++) {
    buf[i] = (char)mn_word_to_int(mn_str_byte(s, mn_int_to_word(i)));
  }
  buf[n] = '\0';
  return buf;
}

static void ensure_openssl(void) {
  if (openssl_ready) {
    return;
  }
  SSL_library_init();
  SSL_load_error_strings();
  OpenSSL_add_all_algorithms();
  client_ctx = SSL_CTX_new(TLS_client_method());
  server_ctx = SSL_CTX_new(TLS_server_method());
  if (client_ctx == NULL || server_ctx == NULL) {
    mn_panic("mn_tls: SSL_CTX_new failed");
  }
  openssl_ready = 1;
}

static int alloc_conn(SSL *ssl, int fd) {
  for (int i = 0; i < MAX_TLS; i++) {
    if (!conns[i].alive) {
      conns[i].ssl = ssl;
      conns[i].fd = fd;
      conns[i].alive = 1;
      return i;
    }
  }
  return -1;
}

static MnTlsConn *get_conn(int id) {
  if (id < 0 || id >= MAX_TLS || !conns[id].alive) {
    return NULL;
  }
  return &conns[id];
}

static void poll_fd(int fd, short events) {
  struct pollfd p;
  p.fd = fd;
  p.events = events;
  p.revents = 0;
  poll(&p, 1, -1);
}

static MnWord handshake_loop(SSL *ssl, int fd) {
  for (;;) {
    int r = SSL_do_handshake(ssl);
    if (r == 1) {
      return MN_EMPTY;
    }
    int err = SSL_get_error(ssl, r);
    if (err == SSL_ERROR_WANT_READ) {
      poll_fd(fd, POLLIN);
      continue;
    }
    if (err == SSL_ERROR_WANT_WRITE) {
      poll_fd(fd, POLLOUT);
      continue;
    }
    return io_other(EIO);
  }
}

MnWord mn_tls_client(MnWord fd_tagged) {
  ensure_openssl();
  int fd = (int)mn_word_to_int(fd_tagged);
  SSL *ssl = SSL_new(client_ctx);
  if (ssl == NULL) {
    return io_other(ENOMEM);
  }
  SSL_set_fd(ssl, fd);
  SSL_set_connect_state(ssl);
  MnWord hs = handshake_loop(ssl, fd);
  if (hs != MN_EMPTY) {
    SSL_free(ssl);
    return hs;
  }
  int id = alloc_conn(ssl, fd);
  if (id < 0) {
    SSL_free(ssl);
    return io_other(ENOMEM);
  }
  return mn_ok(mn_int_to_word((int64_t)id));
}

MnWord mn_tls_server(MnWord fd_tagged, MnWord cert_path, MnWord key_path) {
  ensure_openssl();
  int fd = (int)mn_word_to_int(fd_tagged);
  char *cpath = word_to_cstr(cert_path);
  char *kpath = word_to_cstr(key_path);
  if (cpath == NULL || kpath == NULL) {
    free(cpath);
    free(kpath);
    return io_other(ENOMEM);
  }
  if (SSL_CTX_use_certificate_file(server_ctx, cpath, SSL_FILETYPE_PEM) != 1 ||
      SSL_CTX_use_PrivateKey_file(server_ctx, kpath, SSL_FILETYPE_PEM) != 1) {
    free(cpath);
    free(kpath);
    return io_other(EINVAL);
  }
  free(cpath);
  free(kpath);
  SSL *ssl = SSL_new(server_ctx);
  if (ssl == NULL) {
    return io_other(ENOMEM);
  }
  SSL_set_fd(ssl, fd);
  SSL_set_accept_state(ssl);
  MnWord hs = handshake_loop(ssl, fd);
  if (hs != MN_EMPTY) {
    SSL_free(ssl);
    return hs;
  }
  int id = alloc_conn(ssl, fd);
  if (id < 0) {
    SSL_free(ssl);
    return io_other(ENOMEM);
  }
  return mn_ok(mn_int_to_word((int64_t)id));
}

MnWord mn_tls_read(MnWord id_tagged, MnWord max_tagged) {
  MnTlsConn *c = get_conn((int)mn_word_to_int(id_tagged));
  if (c == NULL) {
    return io_other(EBADF);
  }
  int64_t max = mn_word_to_int(max_tagged);
  if (max <= 0) {
    max = 4096;
  }
  char *buf = (char *)malloc((size_t)max);
  if (buf == NULL) {
    return io_other(ENOMEM);
  }
  for (;;) {
    int n = SSL_read(c->ssl, buf, (int)max);
    if (n > 0) {
      MnWord s = mn_str_new((int64_t)(uintptr_t)buf, (int64_t)n);
      free(buf);
      return mn_ok(s);
    }
    if (n == 0) {
      free(buf);
      return mn_ok(mn_str_new((int64_t)(uintptr_t)"", 0));
    }
    int err = SSL_get_error(c->ssl, n);
    if (err == SSL_ERROR_WANT_READ) {
      poll_fd(c->fd, POLLIN);
      continue;
    }
    if (err == SSL_ERROR_WANT_WRITE) {
      poll_fd(c->fd, POLLOUT);
      continue;
    }
    free(buf);
    return io_other(EIO);
  }
}

MnWord mn_tls_write(MnWord id_tagged, MnWord data) {
  MnTlsConn *c = get_conn((int)mn_word_to_int(id_tagged));
  if (c == NULL) {
    return io_other(EBADF);
  }
  int64_t len = mn_word_to_int(mn_str_byte_length(data));
  char *buf = NULL;
  if (len > 0) {
    buf = (char *)malloc((size_t)len);
    if (buf == NULL) {
      return io_other(ENOMEM);
    }
    for (int64_t i = 0; i < len; i++) {
      buf[i] = (char)mn_word_to_int(mn_str_byte(data, mn_int_to_word(i)));
    }
  }
  int64_t off = 0;
  while (off < len) {
    int n = SSL_write(c->ssl, buf + off, (int)(len - off));
    if (n > 0) {
      off += n;
      continue;
    }
    int err = SSL_get_error(c->ssl, n);
    if (err == SSL_ERROR_WANT_READ) {
      poll_fd(c->fd, POLLIN);
      continue;
    }
    if (err == SSL_ERROR_WANT_WRITE) {
      poll_fd(c->fd, POLLOUT);
      continue;
    }
    free(buf);
    return io_other(EIO);
  }
  free(buf);
  return mn_ok(MN_UNIT);
}

MnWord mn_tls_close(MnWord id_tagged) {
  int id = (int)mn_word_to_int(id_tagged);
  MnTlsConn *c = get_conn(id);
  if (c == NULL) {
    return MN_UNIT;
  }
  SSL_shutdown(c->ssl);
  SSL_free(c->ssl);
  c->ssl = NULL;
  c->alive = 0;
  return MN_UNIT;
}
