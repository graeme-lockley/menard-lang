/**
 * Cooperative task runtime for the TypeScript interpreter (Build D).
 * Stackless: each task owns a Cont[] (or a thunk to start). Mirrors
 * runtime/src/task.c observables — Runtime ABI, not Platform API.
 */
import type { Host } from "../host/host.ts";
import type { Value } from "./value.ts";
import { vInt, vUnit, vVariant } from "./value.ts";

export type Cont = unknown; // filled by eval — structural

export type TaskStatus =
  | "runnable"
  | "running"
  | "suspended"
  | "done"
  | "cancelled";

export type InterpWaitCell = {
  id: number;
  notified: boolean;
  waiter: InterpTask | null;
};

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
  cancelRequested: boolean;
  doneCell: InterpWaitCell;
  waitingOn: InterpWaitCell | null;
  joinWaiter: InterpTask | null;
};

export class TaskPark extends Error {
  constructor() {
    super("TaskPark");
    this.name = "TaskPark";
  }
}

let nextId = 1;
let nextCellId = 1;
let all: InterpTask[] = [];
let allCells: InterpWaitCell[] = [];
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

function allocCell(): InterpWaitCell {
  const c: InterpWaitCell = { id: nextCellId++, notified: false, waiter: null };
  allCells.push(c);
  return c;
}

function findCell(id: number): InterpWaitCell | null {
  return allCells.find((c) => c.id === id) ?? null;
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
    cancelRequested: false,
    doneCell: allocCell(),
    waitingOn: null,
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

function isTerminal(t: InterpTask): boolean {
  return t.status === "done" || t.status === "cancelled";
}

function wakeJoiner(done: InterpTask): void {
  if (done.joinWaiter && !done.joinWaiter.isMain) {
    enqueue(done.joinWaiter);
  }
  done.joinWaiter = null;
}

function notifyCell(c: InterpWaitCell): void {
  c.notified = true;
  if (c.waiter) {
    const w = c.waiter;
    c.waiter = null;
    w.waitingOn = null;
    /* Cont resume does not re-enter waitOnCell, so consume the bit here. */
    c.notified = false;
    if (!w.isMain) enqueue(w);
  }
}

function finishTask(t: InterpTask, status: "done" | "cancelled", result: Value): void {
  t.result = result;
  t.status = status;
  t.cancelRequested = false;
  notifyCell(t.doneCell);
  wakeJoiner(t);
}

function parkCurrent(): void {
  const t = current!;
  if (t.isMain) {
    throw new Error("mn_task: cannot park main");
  }
  if (activeStack === null) {
    throw new Error("mn_task: no active drive stack");
  }
  t.status = "suspended";
  t.stack = activeStack.slice();
  t.resumeValue = vUnit();
  throw new TaskPark();
}

function runOne(t: InterpTask, host: Host): void {
  if (isTerminal(t)) return;
  const saved = current;
  activate(t);
  try {
    if (t.cancelRequested && t.stack === null && t.thunk !== null) {
      finishTask(t, "cancelled", vUnit());
      return;
    }
    if (t.stack !== null && t.resumeValue !== null && continueDrive) {
      const stack = t.stack;
      const rv = t.resumeValue;
      t.stack = null;
      t.resumeValue = null;
      if (t.cancelRequested) {
        finishTask(t, "cancelled", vUnit());
        return;
      }
      try {
        const result = continueDrive(stack, rv, host);
        if (t.cancelRequested || t.status === "cancelled") {
          finishTask(t, "cancelled", vUnit());
        } else {
          finishTask(t, "done", result);
        }
      } catch (e) {
        if (e instanceof TaskPark) return;
        throw e;
      }
    } else if (t.thunk !== null && applyThunk) {
      try {
        const result = applyThunk(t.thunk, host);
        if (t.status === "suspended") return;
        if (t.cancelRequested || t.status === "cancelled") {
          finishTask(t, "cancelled", vUnit());
        } else {
          finishTask(t, "done", result);
        }
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

function waitOnCell(c: InterpWaitCell, host: Host): void {
  const self = current!;
  if (c.notified) {
    c.notified = false;
    return;
  }
  if (self.isMain) {
    while (!c.notified) {
      if (runnable.length > 0) {
        pump(host);
        continue;
      }
      throw new Error("mn_task_wait: main stuck");
    }
    c.notified = false;
    return;
  }
  c.waiter = self;
  self.waitingOn = c;
  parkCurrent();
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
    cancelRequested: false,
    doneCell: allocCell(),
    waitingOn: null,
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
  parkCurrent();
  return vUnit();
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

export function taskYield(host: Host): Value {
  taskEnsureMain();
  const self = current!;
  if (self.isMain) {
    pump(host);
    return vUnit();
  }
  enqueue(self);
  parkCurrent();
  return vUnit();
}

export function taskWaitNew(): Value {
  taskEnsureMain();
  return vInt(BigInt(allocCell().id));
}

export function taskWait(cellId: bigint, host: Host): Value {
  taskEnsureMain();
  const c = findCell(Number(cellId));
  if (!c) throw new Error("mn_task_wait: bad cell");
  waitOnCell(c, host);
  return vUnit();
}

export function taskNotify(cellId: bigint, host: Host): Value {
  taskEnsureMain();
  const c = findCell(Number(cellId));
  if (!c) throw new Error("mn_task_notify: bad cell");
  notifyCell(c);
  if (current?.isMain) {
    pump(host);
  }
  return vUnit();
}

function joinWaitUntilTerminal(target: InterpTask, host: Host): void {
  const self = current!;
  target.joinWaiter = self;

  if (self.isMain) {
    while (!isTerminal(target)) {
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
  } else {
    while (!isTerminal(target)) {
      if (target.status === "suspended" && runnable.length === 0) {
        enqueue(target);
      }
      waitOnCell(target.doneCell, host);
    }
  }

  target.joinWaiter = null;
  activate(self);
}

export function taskJoin(id: bigint, host: Host): Value {
  taskEnsureMain();
  const target = find(Number(id));
  if (!target) throw new Error("mn_task_join: bad id");
  joinWaitUntilTerminal(target, host);
  if (target.status === "cancelled") {
    return vVariant("Err", [vUnit()]);
  }
  return vVariant("Ok", [target.result]);
}

export function taskCancel(id: bigint, host: Host): Value {
  taskEnsureMain();
  const t = find(Number(id));
  if (!t || isTerminal(t)) return vUnit();

  t.cancelRequested = true;

  if (t.status === "running") {
    return vUnit();
  }

  if (t.waitingOn) {
    const c = t.waitingOn;
    t.waitingOn = null;
    if (c.waiter === t) c.waiter = null;
  }

  finishTask(t, "cancelled", vUnit());

  if (current?.isMain) {
    pump(host);
  }
  return vUnit();
}

/** Test helper: reset module state between tests. */
export function taskResetForTests(): void {
  nextId = 1;
  nextCellId = 1;
  all = [];
  allCells = [];
  current = null;
  runnable = [];
  activeStack = null;
}
