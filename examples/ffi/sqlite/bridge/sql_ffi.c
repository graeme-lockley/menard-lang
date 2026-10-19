/*
 * MnWord conversion for SQLite FFI. JSON strings cross the boundary;
 * Menard decodes with std/json. Not part of the Runtime ABI (`mn_*`).
 */
#include "sql_bridge.h"
#include "menard.h"

#include <stdlib.h>
#include <string.h>

static MnWord sql_status_err(SqlStatus st) {
  return mn_err(mn_int_to_word((int64_t)st));
}

static char *sql_str_to_cstr(MnWord s) {
  if (mn_is_immediate(s)) {
    mn_panic("sql_ffi: expected Str");
  }
  int64_t n = (int64_t)((MnWord *)(uintptr_t)s)[1];
  const uint8_t *bytes = (const uint8_t *)(((MnWord *)(uintptr_t)s) + 2);
  char *buf = (char *)malloc((size_t)n + 1);
  if (buf == NULL) {
    mn_panic("sql_ffi: out of memory");
  }
  if (n > 0) {
    memcpy(buf, bytes, (size_t)n);
  }
  buf[n] = '\0';
  return buf;
}

static MnWord sql_cstr_to_str_n(const char *s, size_t n) {
  if (s == NULL) {
    s = "";
    n = 0;
  }
  return mn_str_new((int64_t)(uintptr_t)s, (int64_t)n);
}

static MnWord sql_ok_unit(SqlStatus st) {
  if (st != SQL_OK) {
    return sql_status_err(st);
  }
  return mn_ok(MN_UNIT);
}

static MnWord sql_ok_json(SqlStatus st, char *json) {
  if (st != SQL_OK) {
    free(json);
    return sql_status_err(st);
  }
  size_t n = (json != NULL) ? strlen(json) : 0;
  MnWord out;
  mn_root_push(&out);
  out = sql_cstr_to_str_n(json, n);
  free(json);
  MnWord ok = mn_ok(out);
  mn_root_pop();
  return ok;
}

MnWord sql_open(MnWord path) {
  char *p = sql_str_to_cstr(path);
  SqlStatus st = sql_bridge_open(p);
  free(p);
  return sql_ok_unit(st);
}

MnWord sql_close(void) {
  return sql_ok_unit(sql_bridge_close());
}

MnWord sql_exec(MnWord sql) {
  char *s = sql_str_to_cstr(sql);
  SqlStatus st = sql_bridge_exec(s);
  free(s);
  return sql_ok_unit(st);
}

MnWord sql_query(MnWord sql) {
  char *s = sql_str_to_cstr(sql);
  char *json = NULL;
  SqlStatus st = sql_bridge_query(s, &json);
  free(s);
  return sql_ok_json(st, json);
}

MnWord sql_errmsg(void) {
  const char *msg = sql_bridge_errmsg();
  return sql_cstr_to_str_n(msg, strlen(msg));
}
