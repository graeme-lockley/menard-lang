import { describe, expect, test } from "bun:test";
import { run, diagnose } from "../../../host/src/interp/pipeline.ts";
import { createHost, createVirtualFs, mapNodeErrno } from "../../../host/src/host/index.ts";
import { parseCliArgs } from "../../../host/src/cli/args.ts";

describe("tier-0 host seam", () => {
  test("arg-count and arg read host argv", () => {
    const host = createHost({ argv: ["a", "bb"] });
    const r = run(
      `(do
  (let n (arg-count))
  (let a0 (arg 0))
  (let a1 (arg 1))
  (str-concat (str-concat (show n) ":") (str-concat a0 a1)))`,
      { host },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "str") {
      expect(new TextDecoder().decode(r.value.bytes)).toBe("2:abb");
    }
  });

  test("read-file / write-file over virtual fs", () => {
    const fs = createVirtualFs({ "/in.txt": "hi" });
    const host = createHost({ fs });
    const r = run(
      `(do
  (let data (read-file "/in.txt"))
  (match data
    (Ok s) (write-file "/out.txt" s)
    (Err e) (Err e))
  (read-file "/out.txt"))`,
      { host },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Ok");
      expect(r.value.payloads[0]?.tag).toBe("str");
      if (r.value.payloads[0]?.tag === "str") {
        expect(new TextDecoder().decode(r.value.payloads[0].bytes)).toBe("hi");
      }
    }
  });

  test("read-file missing path is Err NotFound", () => {
    const host = createHost();
    const r = run(`(read-file "/nope")`, { host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      expect(err?.tag).toBe("variant");
      if (err?.tag === "variant") expect(err.ctor).toBe("NotFound");
    }
  });

  test("write to fd 1 reaches stdout", () => {
    const host = createHost();
    const r = run(`(write 1 "xy")`, { host });
    expect(r.ok).toBe(true);
    const out = host.stdout.map((b) => new TextDecoder().decode(b)).join("");
    expect(out).toBe("xy");
  });

  test("exit truncates to 8 bits and surfaces exitCode", () => {
    const host = createHost();
    const r = run(`(exit 300)`, { host });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.exitCode).toBe(300 & 0xff);
  });

  test("seam builtins typecheck", () => {
    const diags = diagnose(`(do
  (arg-count)
  (arg 0)
  (write 1 "x")
  (read-file "a")
  (write-file "b" "c")
  (exit 0))`);
    expect(diags).toEqual([]);
  });

  test("mapNodeErrno covers IoError cases", () => {
    expect(mapNodeErrno("ENOENT").tag).toBe("NotFound");
    expect(mapNodeErrno("EACCES").tag).toBe("Permission");
    expect(mapNodeErrno("EPERM").tag).toBe("Permission");
    expect(mapNodeErrno("EEXIST").tag).toBe("Exists");
    expect(mapNodeErrno("EISDIR").tag).toBe("IsADirectory");
    expect(mapNodeErrno("ENOTDIR").tag).toBe("NotADirectory");
    expect(mapNodeErrno("EINVAL").tag).toBe("InvalidPath");
    expect(mapNodeErrno("EFBIG").tag).toBe("TooLarge");
    const other = mapNodeErrno("EIO");
    expect(other.tag).toBe("Other");
  });
});

describe("CLI argv after --", () => {
  test("parseCliArgs splits program args at --", () => {
    const p = parseCliArgs(["run", "--show-result", "main.mnd", "--", "a", "b"]);
    expect(p).toEqual({
      cmd: "run",
      file: "main.mnd",
      showResult: true,
      argv: ["a", "b"],
    });
  });

  test("parseCliArgs without -- yields empty argv", () => {
    const p = parseCliArgs(["check", "f.mnd"]);
    expect(p).toEqual({
      cmd: "check",
      file: "f.mnd",
      showResult: false,
      argv: [],
    });
  });
});
