import { describe, expect, test } from "bun:test";
import { run, diagnose } from "../../../host/src/interp/pipeline.ts";
import { createHost, createVirtualFs, mapNodeErrno } from "../../../host/src/host/index.ts";
import { parseCliArgs } from "../../../host/src/cli/args.ts";

function runSeam(src: string, host = createHost()) {
  const text = `import std/fs\nimport std/io\nimport std/sys\nimport std/string as String\n${src}`;
  host.writeFile("/main.mnd", new TextEncoder().encode(text));
  return run(text, { path: "/main.mnd", host });
}

describe("tier-0 host seam", () => {
  test("arg-count and arg read host argv", () => {
    const host = createHost({ argv: ["a", "bb"] });
    const r = runSeam(
      `{
  let n = arg-count()
  let a0 = arg(0)
  let a1 = arg(1)
  String.concat(show(n), ":", a0, a1)
}`,
      host,
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "str") {
      expect(new TextDecoder().decode(r.value.bytes)).toBe("2:abb");
    }
  });

  test("read-file / write-file over virtual fs", () => {
    const fs = createVirtualFs({ "/in.txt": "hi" });
    const host = createHost({ fs });
    const r = runSeam(
      `{
  let data = read-file("/in.txt")
  match (data)
    | Ok(s) -> write-file("/out.txt", s)
    | Err(e) -> Err(e)
  read-file("/out.txt")
}`,
      host,
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
    const r = runSeam(`read-file("/nope")`, host);
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
    const r = runSeam(`write(1, "xy")`, host);
    expect(r.ok).toBe(true);
    const out = host.stdout.map((b) => new TextDecoder().decode(b)).join("");
    expect(out).toBe("xy");
  });

  test("exit truncates to 8 bits and surfaces exitCode", () => {
    const host = createHost();
    const r = runSeam(`exit(300)`, host);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.exitCode).toBe(300 & 0xff);
  });

  test("getenv, exists, and rename match the runtime Result shapes", () => {
    const fs = createVirtualFs({ "/a.txt": "hi" });
    const host = createHost({ fs, env: { CC: "clang" } });
    const r = runSeam(
      `{
  let g = getenv("CC")
  let missing = getenv("NO_SUCH")
  let was = exists("/a.txt")
  let moved = rename("/a.txt", "/b.txt")
  let now = exists("/a.txt")
  let there = exists("/b.txt")
  match (g)
    | Some(cc) ->
      match (missing)
        | None ->
          match (moved)
            | Ok(_) ->
              if (was && there && not(now)) -> cc | "bad-flags"
            | Err(_) -> "bad-rename"
        | _ -> "bad-missing"
    | _ -> "bad-getenv"
}`,
      host,
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "str") {
      expect(new TextDecoder().decode(r.value.bytes)).toBe("clang");
    }
  });

  test("rename of a missing path is Err NotFound", () => {
    const host = createHost();
    const r = runSeam(`rename("/nope", "/elsewhere")`, host);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      expect(err?.tag).toBe("variant");
      if (err?.tag === "variant") expect(err.ctor).toBe("NotFound");
    }
  });

  test("seam names typecheck through their modules", () => {
    const host = createHost();
    const src = `import std/fs
import std/io
import std/sys
{
  arg-count()
  arg(0)
  write(1, "x")
  read-file("a")
  write-file("b", "c")
  getenv("CC")
  exists("a")
  rename("a", "b")
  exit(0)
}`;
    host.writeFile("/main.mnd", new TextEncoder().encode(src));
    const diags = diagnose(src, { path: "/main.mnd", host });
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
