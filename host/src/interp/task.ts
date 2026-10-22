/**
 * Cooperative task runtime for the TypeScript interpreter (Build C).
 * Stackless: each task owns a Cont[] (or a thunk to start). Mirrors
 * runtime/src/task.c observables — not Platform API.
 */
import type { Host } from "../host/host.ts";
import type { Value } from "./value.ts";
import { vInt, vUnit } from "./value.ts";

export type Cont = unknown; // filled by eval — structural

export type TaskStatus =
  | "runnable"
  | "running"
  | "suspended"
  | "done"
  | "cancelled";

export type InterpTask = {
  id: number;
  status: TaskStatus;
  thunk: Value | null;
  result: Value;
  /** Saved continuation stack when suspended (opaque Cont[] from eval). */
  stack: unknown[] | null;
  /** Value to feed into resume after park (Unit from suspend). */
  resumeValue: Value | null;
  isMain: boolean;
  joinWaiter: InterpTask | null;
};

export class TaskPark extends Error {
  constructor() {
    super("TaskPark");
    this.name = "TaskPark";
  }
}

let nextId = 1;
let all: InterpTask[] = [];
let current: InterpTask | null = null;
let runnable: InterpTask[] = [];

/** Set by eval.drive while running so suspend can capture the Cont stack. */
let activeStack: unknown[] | null = null;

/** Callback installed by eval to continue a parked Cont stack. */
let continueDrive:
  | ((stack: unknown[], resumeValue: Value, host: Host) => Value)
  | null = null;

/** Callback to apply a thunk (Fn () -> a). */
let applyThunk: ((fn: Value, host: Host) => Value) | null = null;

export function taskSetDrivers(opts: {
  continueDrive: (stack: unknown[], resumeValue: Value, host: Host) => Value;
  applyThunk: (fn: Value, host: Host) => Value;
}): void {
  continueDrive = opts.continueDrive;
  applyThunk = opts.applyThunk;
}

export function taskSetActiveStack(stack: unknown[] | null): void {
  activeStack = stack;
}

export function taskEnsureMain(): InterpTask {
  if (current !== null) return current;
  const t: InterpTask = {
    id: nextId++,
    status: "running",
    thunk: null,
    result: vUnit(),
    stack: null,
    resumeValue: null,
    isMain: true,
    joinWaiter: null,
  };
  all.push(t);
  current = t;
  return t;
}

export function taskCurrent(): InterpTask | null {
  return current;
}

function enqueue(t: InterpTask): void {
  if (t.status === "done" || t.status === "cancelled") return;
  if (runnable.includes(t)) {
    t.status = "runnable";
    return;
  }
  t.status = "runnable";
  runnable.push(t);
}

function dequeue(): InterpTask | null {
  return runnable.shift() ?? null;
}

function find(id: number): InterpTask | null {
  return all.find((t) => t.id === id) ?? null;
}

function activate(t: InterpTask): void {
  current = t;
  t.status = "running";
}

function wakeJoiner(done: InterpTask): void {
  if (done.joinWaiter && !done.joinWaiter.isMain) {
    enqueue(done.joinWaiter);
  }
  done.joinWaiter = null;
}

function runOne(t: InterpTask, host: Host): void {
  const saved = current;
  activate(t);
  try {
    if (t.stack !== null && t.resumeValue !== null && continueDrive) {
      const stack = t.stack;
      const rv = t.resumeValue;
      t.stack = null;
      t.resumeValue = null;
      try {
        const result = continueDrive(stack, rv, host);
        t.result = result;
        t.status = "done";
        wakeJoiner(t);
      } catch (e) {
        if (e instanceof TaskPark) return;
        throw e;
      }
    } else if (t.thunk !== null && applyThunk) {
      try {
        const result = applyThunk(t.thunk, host);
        if (t.status === "suspended") return;
        t.result = result;
        t.status = "done";
        wakeJoiner(t);
      } catch (e) {
        if (e instanceof TaskPark) return;
        throw e;
      }
    }
  } finally {
    if (saved) activate(saved);
  }
}

function pump(host: Host): void {
  for (;;) {
    const t = dequeue();
    if (!t) return;
    runOne(t, host);
  }
}

export function taskSpawn(thunk: Value): Value {
  taskEnsureMain();
  const t: InterpTask = {
    id: nextId++,
    status: "runnable",
    thunk,
    result: vUnit(),
    stack: null,
    resumeValue: null,
    isMain: false,
    joinWaiter: null,
  };
  all.push(t);
  enqueue(t);
  return vInt(BigInt(t.id));
}

export function taskSelf(): Value {
  taskEnsureMain();
  return vInt(BigInt(current!.id));
}

export function taskSuspendForTest(): Value {
  taskEnsureMain();
  const t = current!;
  if (t.isMain) {
    throw new Error("mn_task_suspend_for_test: cannot suspend main");
  }
  if (activeStack === null) {
    throw new Error("mn_task_suspend_for_test: no active drive stack");
  }
  t.status = "suspended";
  t.stack = activeStack.slice();
  t.resumeValue = vUnit();
  throw new TaskPark();
}

export function taskResume(id: bigint, host: Host): Value {
  taskEnsureMain();
  const t = find(Number(id));
  if (!t) throw new Error("mn_task_resume: bad id");
  if (t.status === "suspended" || t.status === "runnable") {
    enqueue(t);
  }
  if (current?.isMain) {
    pump(host);
  }
  return vUnit();
}

export function taskJoin(id: bigint, host: Host): Value {
  taskEnsureMain();
  const target = find(Number(id));
  if (!target) throw new Error("mn_task_join: bad id");
  const self = current!;
  if (!self.isMain) {
    throw new Error("mn_task_join: only main may join in Build C");
  }
  target.joinWaiter = self;
  while (target.status !== "done" && target.status !== "cancelled") {
    if (runnable.length > 0) {
      pump(host);
      continue;
    }
    if (target.status === "runnable" || target.stack !== null || target.thunk) {
      enqueue(target);
      pump(host);
      continue;
    }
    if (target.status === "suspended") {
      enqueue(target);
      pump(host);
      continue;
    }
    throw new Error("mn_task_join: stuck");
  }
  target.joinWaiter = null;
  activate(self);
  return target.result;
}

export function taskCancel(id: bigint): Value {
  taskEnsureMain();
  const t = find(Number(id));
  if (!t) return vUnit();
  if (t.status !== "done") {
    t.status = "cancelled";
    wakeJoiner(t);
  }
  return vUnit();
}

/** Test helper: reset module state between tests. */
export function taskResetForTests(): void {
  nextId = 1;
  all = [];
  current = null;
  runnable = [];
  activeStack = null;
}
