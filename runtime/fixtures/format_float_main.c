/*
 * Native fixture for LANG-02: read hex IEEE64 bits (one per line) from stdin,
 * write mn_format_float text (one per line) to stdout.
 */
#include "menard.h"

#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  char line[128];
  char out[64];
  while (fgets(line, sizeof(line), stdin) != NULL) {
    size_t n = strlen(line);
    while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r')) {
      line[--n] = '\0';
    }
    if (n == 0 || line[0] == '#') continue;
    char *end = NULL;
    unsigned long long bits = strtoull(line, &end, 16);
    if (end == line) {
      fprintf(stderr, "bad hex: %s\n", line);
      return 1;
    }
    double d;
    memcpy(&d, &bits, sizeof(d));
    int len = mn_format_float(d, out, sizeof(out));
    if (len < 0) {
      fprintf(stderr, "format failed\n");
      return 1;
    }
    fwrite(out, 1, (size_t)len, stdout);
    fputc('\n', stdout);
  }
  return 0;
}
