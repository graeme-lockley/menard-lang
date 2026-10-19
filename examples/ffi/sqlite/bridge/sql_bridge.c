/*
 * SQLite proving-ground bridge — sync only; no callbacks into Menard.
 */
#include "sql_bridge.h"

#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static sqlite3 *g_db = NULL;
static char g_err[512] = "";

static void sql_set_err(const char *msg) {
  if (msg == NULL) {
    g_err[0] = '\0';
    return;
  }
  snprintf(g_err, sizeof(g_err), "%s", msg);
}

static void sql_set_sqlite_err(void) {
  if (g_db == NULL) {
    sql_set_err("no database open");
    return;
  }
  sql_set_err(sqlite3_errmsg(g_db));
}

const char *sql_bridge_errmsg(void) {
  return g_err;
}

SqlStatus sql_bridge_close(void) {
  if (g_db == NULL) {
    return SQL_OK;
  }
  int rc = sqlite3_close(g_db);
  g_db = NULL;
  if (rc != SQLITE_OK) {
    sql_set_err(sqlite3_errstr(rc));
    return SQL_ERR;
  }
  sql_set_err("");
  return SQL_OK;
}

SqlStatus sql_bridge_open(const char *path) {
  if (path == NULL || path[0] == '\0') {
    sql_set_err("empty path");
    return SQL_ERR;
  }
  (void)sql_bridge_close();
  int rc = sqlite3_open(path, &g_db);
  if (rc != SQLITE_OK) {
    const char *msg = g_db ? sqlite3_errmsg(g_db) : sqlite3_errstr(rc);
    sql_set_err(msg);
    if (g_db != NULL) {
      sqlite3_close(g_db);
      g_db = NULL;
    }
    return SQL_ERR;
  }
  sql_set_err("");
  return SQL_OK;
}

SqlStatus sql_bridge_exec(const char *sql) {
  if (g_db == NULL) {
    sql_set_err("no database open");
    return SQL_BAD_STATE;
  }
  if (sql == NULL) {
    sql_set_err("null sql");
    return SQL_ERR;
  }
  char *errmsg = NULL;
  int rc = sqlite3_exec(g_db, sql, NULL, NULL, &errmsg);
  if (rc != SQLITE_OK) {
    sql_set_err(errmsg ? errmsg : sqlite3_errmsg(g_db));
    sqlite3_free(errmsg);
    return SQL_ERR;
  }
  sql_set_err("");
  return SQL_OK;
}

/* --- minimal JSON buffer ------------------------------------------------- */

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} JsonBuf;

static int jb_reserve(JsonBuf *b, size_t need) {
  if (b->len + need <= b->cap) {
    return 0;
  }
  size_t ncap = b->cap ? b->cap : 256;
  while (ncap < b->len + need) {
    ncap *= 2;
  }
  char *p = (char *)realloc(b->data, ncap);
  if (p == NULL) {
    return -1;
  }
  b->data = p;
  b->cap = ncap;
  return 0;
}

static int jb_putc(JsonBuf *b, char c) {
  if (jb_reserve(b, 1) != 0) {
    return -1;
  }
  b->data[b->len++] = c;
  return 0;
}

static int jb_puts(JsonBuf *b, const char *s) {
  size_t n = strlen(s);
  if (jb_reserve(b, n) != 0) {
    return -1;
  }
  memcpy(b->data + b->len, s, n);
  b->len += n;
  return 0;
}

static int jb_put_escaped(JsonBuf *b, const unsigned char *s, int n) {
  if (jb_putc(b, '"') != 0) {
    return -1;
  }
  for (int i = 0; i < n; i++) {
    unsigned char c = s[i];
    if (c == '"' || c == '\\') {
      if (jb_putc(b, '\\') != 0 || jb_putc(b, (char)c) != 0) {
        return -1;
      }
    } else if (c == '\n') {
      if (jb_puts(b, "\\n") != 0) {
        return -1;
      }
    } else if (c == '\r') {
      if (jb_puts(b, "\\r") != 0) {
        return -1;
      }
    } else if (c == '\t') {
      if (jb_puts(b, "\\t") != 0) {
        return -1;
      }
    } else if (c < 0x20) {
      char hex[7];
      snprintf(hex, sizeof(hex), "\\u%04x", c);
      if (jb_puts(b, hex) != 0) {
        return -1;
      }
    } else {
      if (jb_putc(b, (char)c) != 0) {
        return -1;
      }
    }
  }
  return jb_putc(b, '"');
}

static int jb_put_col(JsonBuf *b, sqlite3_stmt *st, int i) {
  const char *name = sqlite3_column_name(st, i);
  if (name == NULL) {
    name = "";
  }
  if (jb_put_escaped(b, (const unsigned char *)name, (int)strlen(name)) != 0) {
    return -1;
  }
  if (jb_putc(b, ':') != 0) {
    return -1;
  }
  int t = sqlite3_column_type(st, i);
  if (t == SQLITE_NULL || t == SQLITE_BLOB) {
    return jb_puts(b, "null");
  }
  if (t == SQLITE_INTEGER) {
    char num[32];
    snprintf(num, sizeof(num), "%lld", (long long)sqlite3_column_int64(st, i));
    return jb_puts(b, num);
  }
  if (t == SQLITE_FLOAT) {
    char num[64];
    snprintf(num, sizeof(num), "%.17g", sqlite3_column_double(st, i));
    return jb_puts(b, num);
  }
  /* TEXT (and anything else treated as text) */
  const unsigned char *text = sqlite3_column_text(st, i);
  int nbytes = sqlite3_column_bytes(st, i);
  if (text == NULL) {
    return jb_puts(b, "null");
  }
  return jb_put_escaped(b, text, nbytes);
}

SqlStatus sql_bridge_query(const char *sql, char **json_out) {
  *json_out = NULL;
  if (g_db == NULL) {
    sql_set_err("no database open");
    return SQL_BAD_STATE;
  }
  if (sql == NULL) {
    sql_set_err("null sql");
    return SQL_ERR;
  }

  sqlite3_stmt *st = NULL;
  int rc = sqlite3_prepare_v2(g_db, sql, -1, &st, NULL);
  if (rc != SQLITE_OK) {
    sql_set_sqlite_err();
    return SQL_ERR;
  }

  JsonBuf buf = {0};
  if (jb_putc(&buf, '[') != 0) {
    sqlite3_finalize(st);
    sql_set_err("out of memory");
    return SQL_ERR;
  }

  int ncols = sqlite3_column_count(st);
  int first = 1;
  while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
    if (!first && jb_putc(&buf, ',') != 0) {
      sqlite3_finalize(st);
      free(buf.data);
      sql_set_err("out of memory");
      return SQL_ERR;
    }
    first = 0;
    if (jb_putc(&buf, '{') != 0) {
      sqlite3_finalize(st);
      free(buf.data);
      sql_set_err("out of memory");
      return SQL_ERR;
    }
    for (int i = 0; i < ncols; i++) {
      if (i > 0 && jb_putc(&buf, ',') != 0) {
        sqlite3_finalize(st);
        free(buf.data);
        sql_set_err("out of memory");
        return SQL_ERR;
      }
      if (jb_put_col(&buf, st, i) != 0) {
        sqlite3_finalize(st);
        free(buf.data);
        sql_set_err("out of memory");
        return SQL_ERR;
      }
    }
    if (jb_putc(&buf, '}') != 0) {
      sqlite3_finalize(st);
      free(buf.data);
      sql_set_err("out of memory");
      return SQL_ERR;
    }
  }

  if (rc != SQLITE_DONE) {
    sql_set_sqlite_err();
    sqlite3_finalize(st);
    free(buf.data);
    return SQL_ERR;
  }
  sqlite3_finalize(st);

  if (jb_putc(&buf, ']') != 0 || jb_putc(&buf, '\0') != 0) {
    free(buf.data);
    sql_set_err("out of memory");
    return SQL_ERR;
  }

  *json_out = buf.data;
  sql_set_err("");
  return SQL_OK;
}
