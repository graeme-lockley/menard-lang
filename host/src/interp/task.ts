/**
 * Cooperative task runtime for the TypeScript interpreter (Build D/E).
 * Stackless: each task owns a Cont[] (or a thunk to start). Mirrors
 * runtime/src/task.c observables — Runtime ABI, not Platform API.
 *
 * Wait cells: multi-waiter FIFO; notify wakes ≤1; cancel of a waiter
 * soft-resumes so mn_task_wait returns Err(Unit).
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
  /** Set by notify_all; wait never parks on a closed cell. */
  closed: boolean;
  waitersHead: InterpTask | null;
  waitersTail: InterpTask | null;
};

export type InterpDeferEntry = {
  clo: Value;
  depth: number;
};

export type InterpTask = {
  id: number;
  status: TaskStatus;
  thunk: Value | null;
  result: Value;
  /** Saved continuation stack when suspended (opaque Cont[] from eval). */
  stack: unknown[] | null;
  /** Value to feed into resume after park (Unit from suspend; Result from wait). */
  resumeValue: Value | null;
  isMain: boolean;
  cancelRequested: boolean;
  doneCell: InterpWaitCell;
  waitingOn: InterpWaitCell | null;
  waitNext: InterpTask | null;
  joinWaiter: InterpTask | null;
  /** Newest first; Build F defer cleanups. */
  defers: InterpDeferEntry[];
  deferDepth: number;
  runningDefers: boolean;
  /** Set by timer fire; consumed by waitUntil. */
  waitTimedOut: boolean;
};

type InterpTimer = {
  deadline: bigint;
  task: InterpTask;
  cell: InterpWaitCell;
  alive: boolean;
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
/** Virtual monotonic clock (ms). Advances to the next deadline when idle. */
let monoMs = 0n;
let timers: InterpTimer[] = [];
/** Type-erased process dictionary (Build E registry). */
let processDict = new Map<string, Value>();

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
  const c: InterpWaitCell = {
    id: nextCellId++,
    notified: false,
    closed: false,
    waitersHead: null,
    waitersTail: null,
  };
  allCells.push(c);
  return c;
}

function findCell(id: number): InterpWaitCell | null {
  return allCells.find((c) => c.id === id) ?? null;
}

function waiterEnqueue(c: InterpWaitCell, t: InterpTask): void {
  t.waitNext = null;
  if (c.waitersTail === null) {
    c.waitersHead = c.waitersTail = t;
  } else {
    c.waitersTail.waitNext = t;
    c.waitersTail = t;
  }
}

function waiterUnlink(c: InterpWaitCell, t: InterpTask): void {
  let prev: InterpTask | null = null;
  for (let p = c.waitersHead; p !== null; p = p.waitNext) {
    if (p === t) {
      if (prev === null) c.waitersHead = t.waitNext;
      else prev.waitNext = t.waitNext;
      if (c.waitersTail === t) c.waitersTail = prev;
      t.waitNext = null;
      return;
    }
    prev = p;
  }
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
    waitNext: null,
    joinWaiter: null,
    defers: [],
    deferDepth: 0,
    runningDefers: false,
    waitTimedOut: false,
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
  const j = done.joinWaiter;
  done.joinWaiter = null;
  if (!j || j.isMain) return;
  /* Fiber join parks once; resumeValue is the final mn_task_join Result. */
  if (done.status === "cancelled") {
    j.resumeValue = vVariant("Err", [vUnit()]);
  } else {
    j.resumeValue = vVariant("Ok", [done.result]);
  }
  enqueue(j);
}

function wakeOneWaiter(w: InterpTask): void {
  w.waitNext = null;
  w.waitingOn = null;
  timerDisarmTask(w);
  /* Cont resume does not re-enter waitOnCell — result is in resumeValue. */
  w.resumeValue = vVariant("Ok", [vUnit()]);
  if (!w.isMain) enqueue(w);
}

function timerDisarmTask(t: InterpTask): void {
  timers = timers.filter((tm) => !(tm.alive && tm.task === t));
}

function timerArm(t: InterpTask, c: InterpWaitCell, deadline: bigint): void {
  timerDisarmTask(t);
  timers.push({ deadline, task: t, cell: c, alive: true });
  timers.sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));
}

function timersFireDue(): void {
  while (timers.length > 0 && timers[0]!.alive && timers[0]!.deadline <= monoMs) {
    const fired = timers.shift()!;
    const t = fired.task;
    const c = fired.cell;
    if (t.waitingOn !== c) continue;
    waiterUnlink(c, t);
    t.waitingOn = null;
    t.waitTimedOut = true;
    t.resumeValue = vVariant("Err", [vInt(1n)]);
    if (!t.isMain) enqueue(t);
  }
}

/** When the scheduler is idle, jump virtual time to the next deadline. */
function advanceToNextDeadline(): boolean {
  timersFireDue();
  if (timers.length === 0) return false;
  const next = timers[0]!;
  if (!next.alive) return false;
  if (next.deadline > monoMs) {
    monoMs = next.deadline;
  }
  timersFireDue();
  return true;
}

export function taskMonoMs(): Value {
  return vInt(monoMs);
}

function notifyCell(c: InterpWaitCell): void {
  c.notified = true;
  if (c.waitersHead) {
    const w = c.waitersHead;
    c.waitersHead = w.waitNext;
    if (c.waitersHead === null) c.waitersTail = null;
    c.notified = false; /* consumed by woken waiter */
    wakeOneWaiter(w);
  }
}

/** Close the cell and wake every waiter (Mailbox.close). */
function notifyAllCell(c: InterpWaitCell): void {
  c.closed = true;
  c.notified = true;
  while (c.waitersHead) {
    const w = c.waitersHead;
    c.waitersHead = w.waitNext;
    if (c.waitersHead === null) c.waitersTail = null;
    wakeOneWaiter(w);
  }
}

function runDefersLeave(t: InterpTask, host: Host): void {
  if (t.runningDefers || !applyThunk) return;
  t.runningDefers = true;
  const depth = t.deferDepth;
  while (t.defers.length > 0 && t.defers[0]!.depth === depth) {
    const e = t.defers.shift()!;
    applyThunk(e.clo, host);
  }
  if (t.deferDepth > 0) t.deferDepth--;
  t.runningDefers = false;
}

function runDefersAll(t: InterpTask, host: Host): void {
  if (t.runningDefers || !applyThunk) {
    t.defers = [];
    t.deferDepth = 0;
    return;
  }
  t.runningDefers = true;
  while (t.defers.length > 0) {
    const e = t.defers.shift()!;
    applyThunk(e.clo, host);
  }
  t.deferDepth = 0;
  t.runningDefers = false;
}

function finishTask(t: InterpTask, status: "done" | "cancelled", result: Value, host?: Host): void {
  const saved = current;
  current = t;
  if (host) runDefersAll(t, host);
  else {
    t.defers = [];
    t.deferDepth = 0;
  }
  current = saved;
  t.result = result;
  t.status = status;
  t.cancelRequested = false;
  notifyCell(t.doneCell);
  wakeJoiner(t);
}

function parkCurrent(resumeValue: Value = vUnit()): void {
  const t = current!;
  if (t.isMain) {
    throw new Error("mn_task: cannot park main");
  }
  if (activeStack === null) {
    throw new Error("mn_task: no active drive stack");
  }
  t.status = "suspended";
  t.stack = activeStack.slice();
  t.resumeValue = resumeValue;
  throw new TaskPark();
}

function runOne(t: InterpTask, host: Host): void {
  if (isTerminal(t)) return;
  const saved = current;
  activate(t);
  try {
    if (t.cancelRequested && t.stack === null && t.thunk !== null) {
      finishTask(t, "cancelled", vUnit(), host);
      return;
    }
    if (t.stack !== null && t.resumeValue !== null && continueDrive) {
      const stack = t.stack;
      const rv = t.resumeValue;
      t.stack = null;
      t.resumeValue = null;
      /* Soft cancel from wait: resume Cont with Err Result; do not finish early. */
      const softWaitCancel =
        t.cancelRequested &&
        rv.tag === "variant" &&
        rv.ctor === "Err";
      if (t.cancelRequested && !softWaitCancel) {
        finishTask(t, "cancelled", vUnit(), host);
        return;
      }
      try {
        const result = continueDrive(stack, rv, host);
        if (t.cancelRequested || t.status === "cancelled") {
          finishTask(t, "cancelled", vUnit(), host);
        } else {
          finishTask(t, "done", result, host);
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
          finishTask(t, "cancelled", vUnit(), host);
        } else {
          finishTask(t, "done", result, host);
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

/** Returns Ok/Err Result value, or parks (throws TaskPark). */
function waitOnCell(c: InterpWaitCell, host: Host): Value {
  const self = current!;
  if (self.cancelRequested || self.status === "cancelled") {
    return vVariant("Err", [vUnit()]);
  }
  if (c.closed) {
    return vVariant("Ok", [vUnit()]);
  }
  if (c.notified) {
    c.notified = false;
    return vVariant("Ok", [vUnit()]);
  }
  if (self.isMain) {
    while (!c.notified && !c.closed) {
      if (self.cancelRequested) {
        return vVariant("Err", [vUnit()]);
      }
      timersFireDue();
      if (runnable.length > 0) {
        pump(host);
        continue;
      }
      if (advanceToNextDeadline()) {
        continue;
      }
      throw new Error("mn_task_wait: main stuck");
    }
    if (self.cancelRequested) {
      return vVariant("Err", [vUnit()]);
    }
    if (c.closed) {
      return vVariant("Ok", [vUnit()]);
    }
    c.notified = false;
    return vVariant("Ok", [vUnit()]);
  }
  waiterEnqueue(c, self);
  self.waitingOn = c;
  /* Default resumeValue overwritten by notify/cancel before resume. */
  parkCurrent(vVariant("Ok", [vUnit()]));
  /* unreachable — park throws */
  return vVariant("Ok", [vUnit()]);
}

/** Ok / Err(0)=cancel / Err(1)=timeout. */
function waitOnCellUntil(c: InterpWaitCell, deadline: bigint, host: Host): Value {
  const self = current!;
  self.waitTimedOut = false;
  if (self.cancelRequested || self.status === "cancelled") {
    return vVariant("Err", [vInt(0n)]);
  }
  if (c.closed) {
    return vVariant("Ok", [vUnit()]);
  }
  if (c.notified) {
    c.notified = false;
    return vVariant("Ok", [vUnit()]);
  }
  if (monoMs >= deadline) {
    return vVariant("Err", [vInt(1n)]);
  }
  if (self.isMain) {
    while (!c.notified && !c.closed) {
      if (self.cancelRequested) {
        return vVariant("Err", [vInt(0n)]);
      }
      if (monoMs >= deadline) {
        return vVariant("Err", [vInt(1n)]);
      }
      timersFireDue();
      if (self.waitTimedOut) {
        self.waitTimedOut = false;
        return vVariant("Err", [vInt(1n)]);
      }
      if (runnable.length > 0) {
        pump(host);
        continue;
      }
      /* Arm a timer for this wait so idle advance reaches our deadline. */
      timerArm(self, c, deadline);
      if (!advanceToNextDeadline()) {
        timerDisarmTask(self);
        return vVariant("Err", [vInt(1n)]);
      }
      timerDisarmTask(self);
      if (self.waitTimedOut) {
        self.waitTimedOut = false;
        return vVariant("Err", [vInt(1n)]);
      }
    }
    timerDisarmTask(self);
    if (self.cancelRequested) {
      return vVariant("Err", [vInt(0n)]);
    }
    if (c.closed) {
      return vVariant("Ok", [vUnit()]);
    }
    c.notified = false;
    return vVariant("Ok", [vUnit()]);
  }
  waiterEnqueue(c, self);
  self.waitingOn = c;
  timerArm(self, c, deadline);
  parkCurrent(vVariant("Ok", [vUnit()]));
  return vVariant("Ok", [vUnit()]);
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
    waitNext: null,
    joinWaiter: null,
    defers: [],
    deferDepth: 0,
    runningDefers: false,
    waitTimedOut: false,
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
  parkCurrent(vUnit());
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
  parkCurrent(vUnit());
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
  return waitOnCell(c, host);
}

export function taskWaitUntil(cellId: bigint, deadline: bigint, host: Host): Value {
  taskEnsureMain();
  const c = findCell(Number(cellId));
  if (!c) throw new Error("mn_task_wait_until: bad cell");
  return waitOnCellUntil(c, deadline, host);
}

export function taskSleepMs(ms: bigint, host: Host): Value {
  taskEnsureMain();
  let m = ms;
  if (m < 0n) m = 0n;
  const c = allocCell();
  const deadline = monoMs + m;
  const r = waitOnCellUntil(c, deadline, host);
  if (r.tag === "variant" && r.ctor === "Err") {
    const payload = r.payloads[0];
    if (payload && payload.tag === "int" && payload.value === 0n) {
      return vVariant("Err", [vUnit()]);
    }
  }
  return vVariant("Ok", [vUnit()]);
}

export function taskJoinTimeout(id: bigint, ms: bigint, host: Host): Value {
  taskEnsureMain();
  const target = find(Number(id));
  if (!target) throw new Error("mn_task_join_timeout: bad id");
  let m = ms;
  if (m < 0n) m = 0n;
  const deadline = monoMs + m;

  const wrapInner = (): Value => {
    if (target.status === "cancelled") {
      return vVariant("Ok", [vVariant("Err", [vUnit()])]);
    }
    return vVariant("Ok", [vVariant("Ok", [target.result])]);
  };

  if (isTerminal(target)) {
    return wrapInner();
  }

  const r = waitOnCellUntil(target.doneCell, deadline, host);
  if (r.tag === "variant" && r.ctor === "Err") {
    const payload = r.payloads[0];
    if (payload && payload.tag === "int" && payload.value === 1n && !isTerminal(target)) {
      return vVariant("Err", [vVariant("JoinTimeout")]);
    }
  }
  if (!isTerminal(target)) {
    /* Still need to wait out — pump until terminal or give timeout. */
    while (!isTerminal(target)) {
      if (monoMs >= deadline) {
        return vVariant("Err", [vVariant("JoinTimeout")]);
      }
      if (runnable.length > 0) {
        pump(host);
        continue;
      }
      if (!advanceToNextDeadline()) {
        return vVariant("Err", [vVariant("JoinTimeout")]);
      }
    }
  }
  return wrapInner();
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

export function taskNotifyAll(cellId: bigint, host: Host): Value {
  taskEnsureMain();
  const c = findCell(Number(cellId));
  if (!c) throw new Error("mn_task_notify_all: bad cell");
  notifyAllCell(c);
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

  if (self.isMain) {
    target.joinWaiter = self;
    while (!isTerminal(target)) {
      if (self.cancelRequested) {
        target.joinWaiter = null;
        finishTask(self, "cancelled", vUnit(), host);
        throw new Error("mn_task_join: main cancelled");
      }
      if (runnable.length > 0) {
        pump(host);
        continue;
      }
      if (target.status === "runnable" || target.stack !== null || target.thunk) {
        enqueue(target);
        pump(host);
        continue;
      }
      if (target.status === "suspended" && target.waitingOn === null) {
        /* Synthetic park only — not wait-cell waiters. */
        enqueue(target);
        pump(host);
        continue;
      }
      if (target.status === "suspended" && target.waitingOn !== null) {
        if (runnable.length > 0) {
          pump(host);
          continue;
        }
        if (advanceToNextDeadline()) {
          continue;
        }
        throw new Error("mn_task_join: target waiting on cell");
      }
      throw new Error("mn_task_join: stuck");
    }
    target.joinWaiter = null;
    activate(self);
    if (target.status === "cancelled") {
      return vVariant("Err", [vUnit()]);
    }
    return vVariant("Ok", [target.result]);
  }

  /* Fiber join: park once; finishTask/wakeJoiner sets resumeValue to Result. */
  if (isTerminal(target)) {
    if (target.status === "cancelled") {
      return vVariant("Err", [vUnit()]);
    }
    return vVariant("Ok", [target.result]);
  }
  target.joinWaiter = self;
  if (target.status === "suspended" || target.status === "runnable") {
    enqueue(target);
  }
  parkCurrent(vUnit());
  /* unreachable — Cont resumes with join Result */
  return vVariant("Ok", [vUnit()]);
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
    waiterUnlink(c, t);
    t.waitingOn = null;
    timerDisarmTask(t);
    /* Soft cancel: resume wait with Err; do not consume sticky notify.
     * Err(0) so wait_until can distinguish cancel from timeout. */
    t.resumeValue = vVariant("Err", [vInt(0n)]);
    if (!t.isMain) enqueue(t);
    if (current?.isMain) {
      pump(host);
    }
    return vUnit();
  }

  finishTask(t, "cancelled", vUnit(), host);

  if (current?.isMain) {
    pump(host);
  }
  return vUnit();
}

export function taskDeferEnter(): Value {
  taskEnsureMain();
  current!.deferDepth++;
  return vUnit();
}

export function taskDeferPush(clo: Value): Value {
  taskEnsureMain();
  const t = current!;
  t.defers.unshift({ clo, depth: t.deferDepth });
  return vUnit();
}

export function taskDeferLeave(host: Host): Value {
  taskEnsureMain();
  runDefersLeave(current!, host);
  return vUnit();
}

export function taskDictSet(key: Value, value: Value): Value {
  taskEnsureMain();
  if (key.tag !== "str") throw new Error("mn_task_dict_set: expected Str key");
  const name = new TextDecoder().decode(key.bytes);
  processDict.set(name, value);
  return vUnit();
}

export function taskDictGet(key: Value): Value {
  taskEnsureMain();
  if (key.tag !== "str") throw new Error("mn_task_dict_get: expected Str key");
  const name = new TextDecoder().decode(key.bytes);
  const v = processDict.get(name);
  if (v === undefined) return vVariant("None");
  return vVariant("Some", [v]);
}

/** Test helper: reset module state between tests. */
export function taskResetForTests(): void {
  nextId = 1;
  nextCellId = 1;
  all = [];
  allCells = [];
  current = null;
  runnable = [];
  timers = [];
  monoMs = 0n;
  activeStack = null;
  processDict = new Map();
}
