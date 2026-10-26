/*
 * Micro-benchmark: mn_format_float vs snprintf("%.17g") over a fixed set.
 * Prints "menard_ns=… snprintf_ns=… ratio=…" (menard/snprintf).
 */
#include "menard.h"

#include <math.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

static double now_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}

int main(void) {
  const double vals[] = {
      0.0, -0.0, 1.0, -1.0, 0.1, 0.1 * 0.2, 1.0 / 3.0,
      9007199254740992.0, /* 2^53 */
      9223372036854775808.0, /* 2^63 */
      1e-7, 1e-300, 1e21, 1.5e300,
      4.9406564584124654e-324, /* min subnormal */
      1.7976931348623157e308,  /* max finite */
      INFINITY, -INFINITY, NAN,
      1.2345678901234567, 9.876543210987654e-5,
      3.141592653589793, 2.718281828459045, 1.4142135623730951,
  };
  const int nvals = (int)(sizeof(vals) / sizeof(vals[0]));
  const int iters = 200000;
  char buf[64];
  volatile int sink = 0;

  double t0 = now_ns();
  for (int i = 0; i < iters; i++) {
    for (int j = 0; j < nvals; j++) {
      sink += mn_format_float(vals[j], buf, sizeof(buf));
    }
  }
  double t1 = now_ns();
  for (int i = 0; i < iters; i++) {
    for (int j = 0; j < nvals; j++) {
      sink += snprintf(buf, sizeof(buf), "%.17g", vals[j]);
    }
  }
  double t2 = now_ns();
  (void)sink;
  double menard = t1 - t0;
  double sn = t2 - t1;
  printf("menard_ns=%.0f snprintf_ns=%.0f ratio=%.3f\n", menard, sn, menard / sn);
  return 0;
}
