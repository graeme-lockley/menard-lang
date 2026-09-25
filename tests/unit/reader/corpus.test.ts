import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readAll,
  printAll,
  astEqual,
  checkCasingAll,
} from "../../../host/src/reader/index.ts";

const corpusDir = join(import.meta.dir, "../../corpus");

describe("corpus round-trip", () => {
  const files = readdirSync(corpusDir)
    .filter((f) => f.endsWith(".mnd"))
    .sort();

  for (const file of files) {
    test(file, () => {
      const src = new Uint8Array(readFileSync(join(corpusDir, file)));
      const r1 = readAll(src);
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;

      const casing = checkCasingAll(r1.forms);
      expect(casing.ok).toBe(true);

      const printed = printAll(r1.forms);
      const r2 = readAll(printed);
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;

      expect(r1.forms.length).toBe(r2.forms.length);
      for (let i = 0; i < r1.forms.length; i++) {
        expect(astEqual(r1.forms[i]!, r2.forms[i]!)).toBe(true);
      }

      // print is stable
      expect(printAll(r2.forms)).toEqual(printed);
    });
  }
});
