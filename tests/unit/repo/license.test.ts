import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");

describe("repository licence", () => {
  test("LICENSE is the MIT text with the copyright holder", () => {
    const text = readFileSync(join(root, "LICENSE"), "utf8");
    expect(text).toContain("MIT License");
    expect(text).toContain("Copyright (c) 2026 Graeme Lockley");
    expect(text).toContain("Permission is hereby granted, free of charge");
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  test("the package and README declare MIT", () => {
    const pkg = JSON.parse(readFileSync(join(root, "host/package.json"), "utf8")) as {
      license?: string;
    };
    expect(pkg.license).toBe("MIT");
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("MIT Licence");
  });
});
