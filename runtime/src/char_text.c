/*
 * Canonical Char text (LANG-10). Writes a character literal spelling into buf.
 * Escape set matches the AST printers and docs/menard-spec.md §2.13.
 */
#include "menard.h"

#include <stdio.h>

int mn_format_char(int64_t cp, char *buf, size_t n) {
  if (buf == NULL || n == 0) {
    return -1;
  }
  if (cp == 10) {
    return snprintf(buf, n, "'\\n'");
  }
  if (cp == 13) {
    return snprintf(buf, n, "'\\r'");
  }
  if (cp == 9) {
    return snprintf(buf, n, "'\\t'");
  }
  if (cp == 92) {
    return snprintf(buf, n, "'\\\\'");
  }
  if (cp == 39) {
    return snprintf(buf, n, "'\\''");
  }
  if (cp >= 32 && cp < 127) {
    return snprintf(buf, n, "'%c'", (char)cp);
  }
  /* Non-ASCII / non-printable: '\u{HEX}' with uppercase hex, no padding. */
  if (cp < 0 || cp > 0x10FFFF) {
    return -1;
  }
  return snprintf(buf, n, "'\\u{%llX}'", (unsigned long long)cp);
}

MnWord mn_show_char(MnWord c) {
  char buf[32];
  int len = mn_format_char(mn_word_to_int(c), buf, sizeof(buf));
  if (len < 0) {
    mn_panic("mn_show_char: format failed");
  }
  return mn_str_new((int64_t)(uintptr_t)buf, (int64_t)len);
}
