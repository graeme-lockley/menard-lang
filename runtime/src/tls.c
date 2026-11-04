/*
 * OpenSSL TLS byte-stream seam (Build F / CONC-03).
 * Wraps an already-connected TCP fd. Verified clients check the peer
 * against the system trust store (+ optional MENARD_TLS_CA_FILE), send
 * SNI, and check the hostname. Handshake parks via mn_park_fd.
 */
#include "gc_internal.h"
#include "menard.h"

#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <openssl/err.h>
#include <openssl/ssl.h>
#include <openssl/x509v3.h>

#define HDR ((int64_t)sizeof(void *))
#define TAG_IO_OTHER 27
#define MAX_TLS 64
#define SNI_NAME_MAX 256

typedef struct MnTlsConn {
  SSL *ssl;
  int fd;
  int alive;
  char servername[SNI_NAME_MAX];
} MnTlsConn;

static MnTlsConn conns[MAX_TLS];
static SSL_CTX *client_ctx = NULL;
static SSL_CTX *client_insecure_ctx = NULL;
static SSL_CTX *server_ctx = NULL;
static SSL_CTX *server_sni_ctx = NULL;
static char server_sni_name[SNI_NAME_MAX];
static int openssl_ready = 0;

static MnShape shape_io_other = {
    .tag = TAG_IO_OTHER, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

static MnWord io_other(int err) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_io_other);
  obj[1] = mn_int_to_word((int64_t)err);
  return mn_err((MnWord)obj);
}

static MnWord io_tls_verify_failed(void) {
  return mn_err((MnWord)&mn_static_tls_verify_failed);
}

static MnWord io_tls_handshake_failed(void) {
  return mn_err((MnWord)&mn_static_tls_handshake_failed);
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

/* Drain OpenSSL's error queue without printing — CONC-03: no text leaks. */
static void drain_openssl_errors(void) {
  while (ERR_get_error() != 0) {
  }
}

static int load_verify_paths(SSL_CTX *ctx) {
  if (SSL_CTX_set_default_verify_paths(ctx) != 1) {
    drain_openssl_errors();
    /* Continue — MENARD_TLS_CA_FILE may still supply roots. */
  }
  const char *ca = getenv("MENARD_TLS_CA_FILE");
  if (ca != NULL && ca[0] != '\0') {
    if (SSL_CTX_load_verify_locations(ctx, ca, NULL) != 1) {
      drain_openssl_errors();
      return 0;
    }
  }
  return 1;
}

static int sni_callback(SSL *ssl, int *ad, void *arg) {
  (void)ad;
  (void)arg;
  const char *name = SSL_get_servername(ssl, TLSEXT_NAMETYPE_host_name);
  if (name != NULL && server_sni_ctx != NULL && server_sni_name[0] != '\0' &&
      strcmp(name, server_sni_name) == 0) {
    SSL_set_SSL_CTX(ssl, server_sni_ctx);
  }
  return SSL_TLSEXT_ERR_OK;
}

static void maybe_load_sni_server_ctx(void) {
  const char *name = getenv("MENARD_TLS_SNI_NAME");
  const char *cert = getenv("MENARD_TLS_SNI_CERT");
  const char *key = getenv("MENARD_TLS_SNI_KEY");
  if (name == NULL || name[0] == '\0' || cert == NULL || key == NULL) {
    return;
  }
  if (strlen(name) >= SNI_NAME_MAX) {
    return;
  }
  server_sni_ctx = SSL_CTX_new(TLS_server_method());
  if (server_sni_ctx == NULL) {
    drain_openssl_errors();
    return;
  }
  if (SSL_CTX_use_certificate_file(server_sni_ctx, cert, SSL_FILETYPE_PEM) != 1 ||
      SSL_CTX_use_PrivateKey_file(server_sni_ctx, key, SSL_FILETYPE_PEM) != 1) {
    drain_openssl_errors();
    SSL_CTX_free(server_sni_ctx);
    server_sni_ctx = NULL;
    return;
  }
  memcpy(server_sni_name, name, strlen(name) + 1);
  SSL_CTX_set_tlsext_servername_callback(server_ctx, sni_callback);
}

static void ensure_openssl(void) {
  if (openssl_ready) {
    return;
  }
  SSL_library_init();
  SSL_load_error_strings();
  OpenSSL_add_all_algorithms();
  client_ctx = SSL_CTX_new(TLS_client_method());
  client_insecure_ctx = SSL_CTX_new(TLS_client_method());
  server_ctx = SSL_CTX_new(TLS_server_method());
  if (client_ctx == NULL || client_insecure_ctx == NULL || server_ctx == NULL) {
    mn_panic("mn_tls: SSL_CTX_new failed");
  }
  SSL_CTX_set_verify(client_ctx, SSL_VERIFY_PEER, NULL);
  if (!load_verify_paths(client_ctx)) {
    /* Paths partially loaded; handshakes will fail closed on verify. */
  }
  SSL_CTX_set_verify(client_insecure_ctx, SSL_VERIFY_NONE, NULL);
  server_sni_name[0] = '\0';
  maybe_load_sni_server_ctx();
  openssl_ready = 1;
}

static int alloc_conn(SSL *ssl, int fd) {
  for (int i = 0; i < MAX_TLS; i++) {
    if (!conns[i].alive) {
      conns[i].ssl = ssl;
      conns[i].fd = fd;
      conns[i].alive = 1;
      conns[i].servername[0] = '\0';
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

/* Cooperative park — never blocks the mutator with poll(..., -1). */
static MnWord park_tls(int fd, short events, int64_t deadline_mono) {
  return mn_park_fd(fd, events, deadline_mono);
}

static int verify_failed_after_handshake(SSL *ssl) {
  if (SSL_get_verify_result(ssl) != X509_V_OK) {
    return 1;
  }
  X509 *peer = SSL_get_peer_certificate(ssl);
  if (peer == NULL) {
    return 1;
  }
  X509_free(peer);
  return 0;
}

/* OpenSSL 3+ reports abrupt peer close as SSL_ERROR_SSL with this reason
 * (older releases used SSL_ERROR_SYSCALL). Treat as transport either way. */
static int openssl_unexpected_eof(void) {
#ifdef SSL_R_UNEXPECTED_EOF_WHILE_READING
  unsigned long e = ERR_peek_last_error();
  return ERR_GET_REASON(e) == SSL_R_UNEXPECTED_EOF_WHILE_READING;
#else
  return 0;
#endif
}

/* CONC-19: classify via SSL_get_error. Verify → TlsVerifyFailed; protocol
 * SSL_ERROR_SSL → TlsHandshakeFailed; transport (SYSCALL / ZERO_RETURN /
 * unexpected EOF / …) → Other(errno or EIO). Never print OpenSSL text. */
static MnWord map_handshake_terminal(SSL *ssl, int ssl_err, int saved_errno) {
  if (SSL_get_verify_result(ssl) != X509_V_OK) {
    drain_openssl_errors();
    return io_tls_verify_failed();
  }
  if (ssl_err == SSL_ERROR_SSL && !openssl_unexpected_eof()) {
    drain_openssl_errors();
    return io_tls_handshake_failed();
  }
  drain_openssl_errors();
  return io_other(saved_errno != 0 ? saved_errno : EIO);
}

static MnWord handshake_loop(SSL *ssl, int fd, int64_t deadline_mono) {
  for (;;) {
    errno = 0;
    int r = SSL_do_handshake(ssl);
    if (r == 1) {
      return MN_EMPTY;
    }
    int err = SSL_get_error(ssl, r);
    int saved_errno = errno;
    if (err == SSL_ERROR_WANT_READ) {
      MnWord p = park_tls(fd, POLLIN, deadline_mono);
      if (p != MN_EMPTY) {
        return p;
      }
      continue;
    }
    if (err == SSL_ERROR_WANT_WRITE) {
      MnWord p = park_tls(fd, POLLOUT, deadline_mono);
      if (p != MN_EMPTY) {
        return p;
      }
      continue;
    }
    return map_handshake_terminal(ssl, err, saved_errno);
  }
}

static void capture_servername(MnTlsConn *c) {
  const char *name = SSL_get_servername(c->ssl, TLSEXT_NAMETYPE_host_name);
  if (name == NULL) {
    c->servername[0] = '\0';
    return;
  }
  size_t n = strlen(name);
  if (n >= SNI_NAME_MAX) {
    n = SNI_NAME_MAX - 1;
  }
  memcpy(c->servername, name, n);
  c->servername[n] = '\0';
}

static MnWord tls_client_deadline(int fd, MnWord host_w, int insecure,
                                  int64_t deadline_mono) {
  ensure_openssl();
  char *host = word_to_cstr(host_w);
  if (host == NULL) {
    return io_other(ENOMEM);
  }
  if (host[0] == '\0') {
    free(host);
    return io_other(EINVAL);
  }
  SSL_CTX *ctx = insecure ? client_insecure_ctx : client_ctx;
  SSL *ssl = SSL_new(ctx);
  if (ssl == NULL) {
    free(host);
    drain_openssl_errors();
    return io_other(ENOMEM);
  }
  if (SSL_set_tlsext_host_name(ssl, host) != 1) {
    free(host);
    SSL_free(ssl);
    drain_openssl_errors();
    return io_tls_handshake_failed();
  }
  if (!insecure) {
    X509_VERIFY_PARAM *param = SSL_get0_param(ssl);
    if (param == NULL ||
        X509_VERIFY_PARAM_set1_host(param, host, strlen(host)) != 1) {
      free(host);
      SSL_free(ssl);
      drain_openssl_errors();
      return io_tls_verify_failed();
    }
  }
  free(host);
  SSL_set_fd(ssl, fd);
  SSL_set_connect_state(ssl);
  MnWord hs = handshake_loop(ssl, fd, deadline_mono);
  if (hs != MN_EMPTY) {
    SSL_free(ssl);
    return hs;
  }
  if (!insecure && verify_failed_after_handshake(ssl)) {
    SSL_free(ssl);
    return io_tls_verify_failed();
  }
  int id = alloc_conn(ssl, fd);
  if (id < 0) {
    SSL_free(ssl);
    return io_other(ENOMEM);
  }
  return mn_ok(mn_int_to_word((int64_t)id));
}

MnWord mn_tls_client(MnWord fd_tagged, MnWord host) {
  return tls_client_deadline((int)mn_word_to_int(fd_tagged), host, 0, -1);
}

MnWord mn_tls_client_timeout(MnWord fd_tagged, MnWord host, MnWord ms_tagged) {
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tls_client_deadline((int)mn_word_to_int(fd_tagged), host, 0,
                             mn_mono_now_ms() + ms);
}

MnWord mn_tls_client_insecure(MnWord fd_tagged, MnWord host) {
  return tls_client_deadline((int)mn_word_to_int(fd_tagged), host, 1, -1);
}

MnWord mn_tls_client_insecure_timeout(MnWord fd_tagged, MnWord host,
                                      MnWord ms_tagged) {
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tls_client_deadline((int)mn_word_to_int(fd_tagged), host, 1,
                             mn_mono_now_ms() + ms);
}

static MnWord tls_server_deadline(int fd, MnWord cert_path, MnWord key_path,
                                  int64_t deadline_mono) {
  ensure_openssl();
  char *cpath = word_to_cstr(cert_path);
  char *kpath = word_to_cstr(key_path);
  if (cpath == NULL || kpath == NULL) {
    free(cpath);
    free(kpath);
    return io_other(ENOMEM);
  }
  if (access(cpath, R_OK) != 0 || access(kpath, R_OK) != 0) {
    free(cpath);
    free(kpath);
    return mn_err((MnWord)&mn_static_not_found);
  }
  if (SSL_CTX_use_certificate_file(server_ctx, cpath, SSL_FILETYPE_PEM) != 1 ||
      SSL_CTX_use_PrivateKey_file(server_ctx, kpath, SSL_FILETYPE_PEM) != 1) {
    free(cpath);
    free(kpath);
    drain_openssl_errors();
    return mn_err((MnWord)&mn_static_invalid_path);
  }
  free(cpath);
  free(kpath);
  SSL *ssl = SSL_new(server_ctx);
  if (ssl == NULL) {
    drain_openssl_errors();
    return io_other(ENOMEM);
  }
  SSL_set_fd(ssl, fd);
  SSL_set_accept_state(ssl);
  MnWord hs = handshake_loop(ssl, fd, deadline_mono);
  if (hs != MN_EMPTY) {
    SSL_free(ssl);
    return hs;
  }
  int id = alloc_conn(ssl, fd);
  if (id < 0) {
    SSL_free(ssl);
    return io_other(ENOMEM);
  }
  capture_servername(&conns[id]);
  return mn_ok(mn_int_to_word((int64_t)id));
}

MnWord mn_tls_server(MnWord fd_tagged, MnWord cert_path, MnWord key_path) {
  return tls_server_deadline((int)mn_word_to_int(fd_tagged), cert_path, key_path, -1);
}

MnWord mn_tls_server_timeout(MnWord fd_tagged, MnWord cert_path, MnWord key_path,
                             MnWord ms_tagged) {
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tls_server_deadline((int)mn_word_to_int(fd_tagged), cert_path, key_path,
                             mn_mono_now_ms() + ms);
}

static MnWord tls_read_deadline(MnTlsConn *c, int64_t max, int64_t deadline_mono) {
  if (max <= 0) {
    max = 4096;
  }
  char *buf = (char *)malloc((size_t)max);
  if (buf == NULL) {
    return io_other(ENOMEM);
  }
  for (;;) {
    errno = 0;
    int n = SSL_read(c->ssl, buf, (int)max);
    if (n > 0) {
      MnWord s = mn_str_new((int64_t)(uintptr_t)buf, (int64_t)n);
      free(buf);
      return mn_ok(s);
    }
    /* CONC-19: classify every n <= 0 via SSL_get_error — only ZERO_RETURN is EOF. */
    int err = SSL_get_error(c->ssl, n);
    int saved_errno = errno;
    if (err == SSL_ERROR_WANT_READ) {
      MnWord p = park_tls(c->fd, POLLIN, deadline_mono);
      if (p != MN_EMPTY) {
        free(buf);
        return p;
      }
      continue;
    }
    if (err == SSL_ERROR_WANT_WRITE) {
      MnWord p = park_tls(c->fd, POLLOUT, deadline_mono);
      if (p != MN_EMPTY) {
        free(buf);
        return p;
      }
      continue;
    }
    if (err == SSL_ERROR_ZERO_RETURN) {
      free(buf);
      drain_openssl_errors();
      return mn_ok(mn_str_new((int64_t)(uintptr_t)"", 0));
    }
    free(buf);
    drain_openssl_errors();
    return io_other(saved_errno != 0 ? saved_errno : EIO);
  }
}

MnWord mn_tls_read(MnWord id_tagged, MnWord max_tagged) {
  MnTlsConn *c = get_conn((int)mn_word_to_int(id_tagged));
  if (c == NULL) {
    return io_other(EBADF);
  }
  return tls_read_deadline(c, mn_word_to_int(max_tagged), -1);
}

MnWord mn_tls_read_timeout(MnWord id_tagged, MnWord max_tagged, MnWord ms_tagged) {
  MnTlsConn *c = get_conn((int)mn_word_to_int(id_tagged));
  if (c == NULL) {
    return io_other(EBADF);
  }
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tls_read_deadline(c, mn_word_to_int(max_tagged), mn_mono_now_ms() + ms);
}

static MnWord tls_write_deadline(MnTlsConn *c, MnWord data, int64_t deadline_mono) {
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
      MnWord p = park_tls(c->fd, POLLIN, deadline_mono);
      if (p != MN_EMPTY) {
        free(buf);
        return p;
      }
      continue;
    }
    if (err == SSL_ERROR_WANT_WRITE) {
      MnWord p = park_tls(c->fd, POLLOUT, deadline_mono);
      if (p != MN_EMPTY) {
        free(buf);
        return p;
      }
      continue;
    }
    free(buf);
    drain_openssl_errors();
    return io_other(EIO);
  }
  free(buf);
  return mn_ok(MN_UNIT);
}

MnWord mn_tls_write(MnWord id_tagged, MnWord data) {
  MnTlsConn *c = get_conn((int)mn_word_to_int(id_tagged));
  if (c == NULL) {
    return io_other(EBADF);
  }
  return tls_write_deadline(c, data, -1);
}

MnWord mn_tls_write_timeout(MnWord id_tagged, MnWord data, MnWord ms_tagged) {
  MnTlsConn *c = get_conn((int)mn_word_to_int(id_tagged));
  if (c == NULL) {
    return io_other(EBADF);
  }
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  return tls_write_deadline(c, data, mn_mono_now_ms() + ms);
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
  c->servername[0] = '\0';
  return MN_UNIT;
}
