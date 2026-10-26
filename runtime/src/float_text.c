/*
 * Canonical Float text (LANG-02). C is the reference implementation.
 *
 * Digit generation: Ryu (runtime/third_party/ryu). Presentation: Menard
 * grammar — nan/inf/-inf, 0.0/-0.0, fixed vs scientific with lowercase e
 * and a mandatory exponent sign; always a float lexeme (. or e).
 */
#include "menard.h"

#include "ryu/ryu.h"

#include <stdint.h>
#include <string.h>

static int emit(char *buf, size_t n, const char *s) {
  size_t len = strlen(s);
  if (len + 1 > n) return -1;
  memcpy(buf, s, len + 1);
  return (int)len;
}

/* Estimated length of the fixed form (including sign and trailing NUL slot). */
static int fixed_len_est(int neg, int nd, int k) {
  int n = neg;
  if (k >= 0) return n + nd + k + 2;           /* digits + zeros + ".0" */
  if (-k < nd) return n + nd + 1;              /* point inside digits */
  if (-k == nd) return n + 2 + nd;             /* 0.digits */
  return n + 2 + (-k - nd) + nd;               /* 0.000…digits */
}

/* value = sign * int(digits[0..n)) * 10^k  (digits have no decimal point). */
static int format_from_parts(char *buf, size_t nbuf, int neg, const char *digits, int nd,
                             int k) {
  char sci[32];
  char fixed[32];
  int si = 0;
  int fi = 0;

  if (neg) sci[si++] = '-';

  /* Scientific: d[.ddd]e±exp */
  {
    int exp = k + nd - 1;
    sci[si++] = digits[0];
    if (nd > 1) {
      sci[si++] = '.';
      memcpy(sci + si, digits + 1, (size_t)(nd - 1));
      si += nd - 1;
    }
    sci[si++] = 'e';
    if (exp < 0) {
      sci[si++] = '-';
      exp = -exp;
    } else {
      sci[si++] = '+';
    }
    if (exp >= 100) {
      sci[si++] = (char)('0' + exp / 100);
      sci[si++] = (char)('0' + (exp / 10) % 10);
      sci[si++] = (char)('0' + exp % 10);
    } else if (exp >= 10) {
      sci[si++] = (char)('0' + exp / 10);
      sci[si++] = (char)('0' + exp % 10);
    } else {
      sci[si++] = (char)('0' + exp);
    }
    sci[si] = '\0';
  }

  /* Skip fixed when it cannot fit a short buffer or would be longer than sci. */
  if (fixed_len_est(neg, nd, k) >= (int)sizeof(fixed) ||
      fixed_len_est(neg, nd, k) > si) {
    return emit(buf, nbuf, sci);
  }

  if (neg) fixed[fi++] = '-';
  if (k >= 0) {
    memcpy(fixed + fi, digits, (size_t)nd);
    fi += nd;
    for (int i = 0; i < k; i++) fixed[fi++] = '0';
    fixed[fi++] = '.';
    fixed[fi++] = '0';
  } else if (-k < nd) {
    int before = nd + k;
    memcpy(fixed + fi, digits, (size_t)before);
    fi += before;
    fixed[fi++] = '.';
    memcpy(fixed + fi, digits + before, (size_t)(-k));
    fi += -k;
  } else if (-k == nd) {
    fixed[fi++] = '0';
    fixed[fi++] = '.';
    memcpy(fixed + fi, digits, (size_t)nd);
    fi += nd;
  } else {
    int zeros = -k - nd;
    fixed[fi++] = '0';
    fixed[fi++] = '.';
    for (int i = 0; i < zeros; i++) fixed[fi++] = '0';
    memcpy(fixed + fi, digits, (size_t)nd);
    fi += nd;
  }
  fixed[fi] = '\0';

  /* Prefer shorter; on a tie prefer fixed (1.0 over 1e+0). */
  if (si < fi) return emit(buf, nbuf, sci);
  return emit(buf, nbuf, fixed);
}

/*
 * Parse Ryu scientific `[-]d[.ddd]E[-]exp` into digits + k
 * (value = int(digits) * 10^k).
 */
static int parse_ryu(const char *s, int *neg, char *digits, int *nd, int *k) {
  int i = 0;
  *neg = 0;
  if (s[i] == '-') {
    *neg = 1;
    i++;
  }
  int di = 0;
  int point = -1;
  while (s[i] && s[i] != 'E' && s[i] != 'e') {
    if (s[i] == '.') {
      point = di;
      i++;
      continue;
    }
    if (s[i] < '0' || s[i] > '9') return -1;
    digits[di++] = s[i++];
  }
  if (di == 0) return -1;
  digits[di] = '\0';
  *nd = di;
  if (s[i] != 'E' && s[i] != 'e') return -1;
  i++;
  int exp_neg = 0;
  if (s[i] == '-') {
    exp_neg = 1;
    i++;
  } else if (s[i] == '+') {
    i++;
  }
  int exp = 0;
  if (s[i] < '0' || s[i] > '9') return -1;
  while (s[i] >= '0' && s[i] <= '9') {
    exp = exp * 10 + (s[i++] - '0');
  }
  if (s[i] != '\0') return -1;
  if (exp_neg) exp = -exp;
  /* Ryu: first digit is at 10^exp; remaining digits follow.
   * int(digits) * 10^k = significand * 10^exp with point after digit 0
   * ⇒ k = exp - (nd - 1). */
  (void)point;
  *k = exp - (di - 1);
  return 0;
}

int mn_format_float(double d, char *buf, size_t n) {
  uint64_t bits;
  memcpy(&bits, &d, sizeof(bits));
  const int sign = (int)(bits >> 63);
  const uint64_t mant = bits & ((1ull << 52) - 1);
  const uint32_t exp = (uint32_t)((bits >> 52) & 0x7ffu);

  if (exp == 0x7ffu) {
    if (mant != 0) return emit(buf, n, "nan");
    return emit(buf, n, sign ? "-inf" : "inf");
  }
  if (exp == 0 && mant == 0) {
    return emit(buf, n, sign ? "-0.0" : "0.0");
  }

  char ryu[32];
  d2s_buffered(d, ryu);

  /* Ryu zeros use 0E0; we already handled IEEE zeros above. */
  int neg = 0;
  char digits[24];
  int nd = 0;
  int k = 0;
  if (parse_ryu(ryu, &neg, digits, &nd, &k) != 0) {
    /* Fallback should not happen; keep something deterministic. */
    return emit(buf, n, ryu);
  }
  return format_from_parts(buf, n, neg, digits, nd, k);
}
