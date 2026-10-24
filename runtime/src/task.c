/*
 * Cooperative single-mutator task runtime (Build D).
 *
 * Native: task-local fiber stacks (ucontext). Menard values live in
 * per-task shadow stacks (GC). Pump model: join/resume/yield drive
 * runnable fibers via a host context on the caller's stack.
 *
 * Wait cells provide the atomic-wait guarantee (notify-before-wait does
 * not lose a wakeup). Public Platform API is std/task; this file is the
 * Runtime ABI behind it (plus internal harness symbols).
 */
#define _XOPEN_SOURCE 700

#include "gc_internal.h"
#include "menard.h"

#include <stdlib.h>
#include <string.h>
#include <ucontext.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

#define MN_TASK_STACK_BYTES ((size_t)256 * 1024)

typedef enum {
  MN_TASK_RUNNABLE = 0,
  MN_TASK_RUNNING = 1,
  MN_TASK_SUSPENDED = 2,
  MN_TASK_DONE = 3,
  MN_TASK_CANCELLED = 4
} MnTaskStatus;

typedef struct MnWaitCell {
  int id;
  int notified;
  struct MnTask *waiter;
  struct MnWaitCell *next;
} MnWaitCell;

typedef struct MnTask {
  int id;
  MnTaskStatus status;
  MnWord closure;
  MnWord result;
  MnShadow *shadow;
  char *stack_mem;
  ucontext_t ctx;
  int started;
  int is_main;
  int cancel_requested;
  MnWaitCell *done_cell;
  MnWaitCell *waiting_on;
  struct MnTask *join_waiter;
  struct MnTask *next_runnable;
  struct MnTask *all_next;
} MnTask;

static MnTask *all_tasks = NULL;
static int next_id = 1;

static MnWaitCell *all_cells = NULL;
static int next_cell_id = 1;

static MnTask *current = NULL;
static MnTask *runnable_head = NULL;
static MnTask *runnable_tail = NULL;

static ucontext_t *host_ctx = NULL;

static void ensure_main_task(void);
static void enqueue(MnTask *t);
static MnTask *dequeue(void);
static MnTask *task_by_id(int id);
static MnWaitCell *cell_by_id(int id);
static MnWaitCell *alloc_cell(void);
static void run_one(MnTask *t);
static void pump(void);
static void run_task_body(void);
static void park_current(void);
static void notify_cell(MnWaitCell *c);
static void finish_task(MnTask *t, MnTaskStatus st, MnWord result);
static int is_terminal(MnTask *t);

static void enqueue(MnTask *t) {
  if (t == NULL) {
    return;
  }
  if (t->status == MN_TASK_DONE || t->status == MN_TASK_CANCELLED) {
    return;
  }
  for (MnTask *p = runnable_head; p != NULL; p = p->next_runnable) {
    if (p == t) {
      t->status = MN_TASK_RUNNABLE;
      return;
    }
  }
  t->status = MN_TASK_RUNNABLE;
  t->next_runnable = NULL;
  if (runnable_tail == NULL) {
    runnable_head = runnable_tail = t;
  } else {
    runnable_tail->next_runnable = t;
    runnable_tail = t;
  }
}

static MnTask *dequeue(void) {
  MnTask *t = runnable_head;
  if (t == NULL) {
    return NULL;
  }
  runnable_head = t->next_runnable;
  if (runnable_head == NULL) {
    runnable_tail = NULL;
  }
  t->next_runnable = NULL;
  return t;
}

static MnTask *task_by_id(int id) {
  for (MnTask *t = all_tasks; t != NULL; t = t->all_next) {
    if (t->id == id) {
      return t;
    }
  }
  return NULL;
}

static MnWaitCell *cell_by_id(int id) {
  for (MnWaitCell *c = all_cells; c != NULL; c = c->next) {
    if (c->id == id) {
      return c;
    }
  }
  return NULL;
}

static MnTask *alloc_task(void) {
  MnTask *t = (MnTask *)calloc(1, sizeof(MnTask));
  if (t == NULL) {
    mn_panic("mn_task: oom");
  }
  t->all_next = all_tasks;
  all_tasks = t;
  return t;
}

static MnWaitCell *alloc_cell(void) {
  MnWaitCell *c = (MnWaitCell *)calloc(1, sizeof(MnWaitCell));
  if (c == NULL) {
    mn_panic("mn_task: wait cell oom");
  }
  c->id = next_cell_id++;
  c->next = all_cells;
  all_cells = c;
  return c;
}

static void ensure_main_task(void) {
  if (current != NULL) {
    return;
  }
  MnTask *t = alloc_task();
  t->id = next_id++;
  t->status = MN_TASK_RUNNING;
  t->closure = MN_EMPTY;
  t->result = MN_UNIT;
  t->shadow = mn_shadow_active();
  mn_shadow_register(t->shadow);
  t->is_main = 1;
  t->started = 1;
  t->done_cell = alloc_cell();
  current = t;
}

static void activate(MnTask *t) {
  current = t;
  mn_shadow_set_active(t->shadow);
  t->status = MN_TASK_RUNNING;
}

static int is_terminal(MnTask *t) {
  return t->status == MN_TASK_DONE || t->status == MN_TASK_CANCELLED;
}

static void wake_joiner(MnTask *done) {
  if (done->join_waiter != NULL) {
    MnTask *w = done->join_waiter;
    done->join_waiter = NULL;
    if (!w->is_main) {
      enqueue(w);
    }
  }
}

static void notify_cell(MnWaitCell *c) {
  if (c == NULL) {
    return;
  }
  c->notified = 1;
  if (c->waiter != NULL) {
    MnTask *w = c->waiter;
    c->waiter = NULL;
    w->waiting_on = NULL;
    if (!w->is_main) {
      enqueue(w);
    }
  }
}

static void finish_task(MnTask *t, MnTaskStatus st, MnWord result) {
  t->result = result;
  t->status = st;
  t->cancel_requested = 0;
  notify_cell(t->done_cell);
  wake_joiner(t);
}

static void park_current(void) {
  MnTask *t = current;
  if (t->is_main) {
    mn_panic("mn_task: cannot park main");
  }
  if (host_ctx == NULL) {
    mn_panic("mn_task: park without host");
  }
  t->status = MN_TASK_SUSPENDED;
  swapcontext(&t->ctx, host_ctx);
  activate(t);
  if (t->cancel_requested || t->status == MN_TASK_CANCELLED) {
    finish_task(t, MN_TASK_CANCELLED, MN_UNIT);
    if (host_ctx == NULL) {
      mn_panic("mn_task: cancelled with no host");
    }
    swapcontext(&t->ctx, host_ctx);
    mn_panic("mn_task: resume after cancel");
  }
}

static void start_fiber(MnTask *t) {
  if (t->started) {
    return;
  }
  t->started = 1;
  if (getcontext(&t->ctx) != 0) {
    mn_panic("mn_task: getcontext failed");
  }
  t->stack_mem = (char *)malloc(MN_TASK_STACK_BYTES);
  if (t->stack_mem == NULL) {
    mn_panic("mn_task: stack oom");
  }
  t->ctx.uc_stack.ss_sp = t->stack_mem;
  t->ctx.uc_stack.ss_size = MN_TASK_STACK_BYTES;
  t->ctx.uc_link = NULL;
  makecontext(&t->ctx, run_task_body, 0);
}

static void run_task_body(void) {
  MnTask *t = current;
  if (t->cancel_requested) {
    finish_task(t, MN_TASK_CANCELLED, MN_UNIT);
    if (host_ctx == NULL) {
      mn_panic("mn_task: fiber finished with no host");
    }
    swapcontext(&t->ctx, host_ctx);
    mn_panic("mn_task: resume after cancel");
  }
  MnWord clo;
  mn_root_push(&clo);
  clo = t->closure;
  MnWord r = mn_apply_0(clo);
  mn_root_pop();
  if (t->cancel_requested || t->status == MN_TASK_CANCELLED) {
    finish_task(t, MN_TASK_CANCELLED, MN_UNIT);
  } else {
    finish_task(t, MN_TASK_DONE, r);
  }
  if (host_ctx == NULL) {
    mn_panic("mn_task: fiber finished with no host");
  }
  swapcontext(&t->ctx, host_ctx);
  mn_panic("mn_task: resume after done");
}

static void run_one(MnTask *t) {
  if (is_terminal(t)) {
    return;
  }
  ucontext_t here;
  ucontext_t *saved_host = host_ctx;
  MnTask *saved_current = current;

  host_ctx = &here;
  activate(t);
  start_fiber(t);
  swapcontext(&here, &t->ctx);

  host_ctx = saved_host;
  if (saved_current != NULL) {
    activate(saved_current);
  }
}

static void pump(void) {
  for (;;) {
    MnTask *t = dequeue();
    if (t == NULL) {
      return;
    }
    run_one(t);
  }
}

/* Atomic wait: check notified bit, else register waiter and park.
 * Single-mutator — no Menard runs between check and park. */
static void wait_on_cell(MnWaitCell *c) {
  MnTask *self = current;
  if (c->notified) {
    c->notified = 0;
    return;
  }
  if (self->is_main) {
    while (!c->notified) {
      if (runnable_head != NULL) {
        pump();
        continue;
      }
      mn_panic("mn_task_wait: main stuck");
    }
    c->notified = 0;
    return;
  }
  c->waiter = self;
  self->waiting_on = c;
  park_current();
  c->notified = 0;
}

void mn_task_visit_roots(mn_root_visit_fn fn, void *ctx) {
  for (MnTask *t = all_tasks; t != NULL; t = t->all_next) {
    fn(&t->closure, ctx);
    fn(&t->result, ctx);
  }
}

MnWord mn_task_spawn(MnWord closure) {
  ensure_main_task();
  MnWord held;
  mn_root_push(&held);
  held = closure;

  MnTask *t = alloc_task();
  t->id = next_id++;
  t->closure = held;
  t->result = MN_UNIT;
  t->shadow = mn_shadow_new();
  mn_shadow_register(t->shadow);
  t->started = 0;
  t->is_main = 0;
  t->done_cell = alloc_cell();
  enqueue(t);

  mn_root_pop();
  return mn_int_to_word((int64_t)t->id);
}

MnWord mn_task_self(void) {
  ensure_main_task();
  return mn_int_to_word((int64_t)current->id);
}

MnWord mn_task_suspend_for_test(void) {
  ensure_main_task();
  park_current();
  return MN_UNIT;
}

MnWord mn_task_resume(MnWord id_tagged) {
  ensure_main_task();
  int id = (int)mn_word_to_int(id_tagged);
  MnTask *t = task_by_id(id);
  if (t == NULL) {
    mn_panic("mn_task_resume: bad id");
  }
  if (t->status == MN_TASK_SUSPENDED || t->status == MN_TASK_RUNNABLE) {
    enqueue(t);
  }
  if (current != NULL && current->is_main && host_ctx == NULL) {
    pump();
  }
  return MN_UNIT;
}

MnWord mn_task_yield(void) {
  ensure_main_task();
  MnTask *self = current;
  if (self->is_main) {
    pump();
    return MN_UNIT;
  }
  enqueue(self);
  park_current();
  return MN_UNIT;
}

MnWord mn_task_wait_new(void) {
  ensure_main_task();
  MnWaitCell *c = alloc_cell();
  return mn_int_to_word((int64_t)c->id);
}

MnWord mn_task_wait(MnWord cell_tagged) {
  ensure_main_task();
  int id = (int)mn_word_to_int(cell_tagged);
  MnWaitCell *c = cell_by_id(id);
  if (c == NULL) {
    mn_panic("mn_task_wait: bad cell");
  }
  wait_on_cell(c);
  if (current->cancel_requested || current->status == MN_TASK_CANCELLED) {
    /* park_current already finishes cancelled fibers; main returns. */
  }
  return MN_UNIT;
}

MnWord mn_task_notify(MnWord cell_tagged) {
  ensure_main_task();
  int id = (int)mn_word_to_int(cell_tagged);
  MnWaitCell *c = cell_by_id(id);
  if (c == NULL) {
    mn_panic("mn_task_notify: bad cell");
  }
  notify_cell(c);
  if (current != NULL && current->is_main && host_ctx == NULL) {
    pump();
  }
  return MN_UNIT;
}

static void join_wait_until_terminal(MnTask *target) {
  MnTask *self = current;
  target->join_waiter = self;

  if (self->is_main) {
    while (!is_terminal(target)) {
      if (runnable_head != NULL) {
        pump();
        continue;
      }
      if (!target->started || target->status == MN_TASK_RUNNABLE) {
        enqueue(target);
        pump();
        continue;
      }
      if (target->status == MN_TASK_SUSPENDED) {
        /* Auto-resume to avoid join deadlock (Build C behaviour). */
        enqueue(target);
        pump();
        continue;
      }
      mn_panic("mn_task_join: stuck");
    }
  } else {
    while (!is_terminal(target)) {
      if (target->status == MN_TASK_SUSPENDED && runnable_head == NULL) {
        enqueue(target);
      }
      wait_on_cell(target->done_cell);
    }
  }

  target->join_waiter = NULL;
  activate(self);
}

MnWord mn_task_join(MnWord id_tagged) {
  ensure_main_task();
  int id = (int)mn_word_to_int(id_tagged);
  MnTask *target = task_by_id(id);
  if (target == NULL) {
    mn_panic("mn_task_join: bad id");
  }

  join_wait_until_terminal(target);

  MnWord out;
  mn_root_push(&out);
  if (target->status == MN_TASK_CANCELLED) {
    out = mn_err(MN_UNIT);
  } else {
    out = mn_ok(target->result);
  }
  mn_root_pop();
  return out;
}

MnWord mn_task_cancel(MnWord id_tagged) {
  ensure_main_task();
  int id = (int)mn_word_to_int(id_tagged);
  MnTask *t = task_by_id(id);
  if (t == NULL || is_terminal(t)) {
    return MN_UNIT;
  }

  t->cancel_requested = 1;

  if (t->status == MN_TASK_RUNNING) {
    /* Cooperative: takes effect at the next park/yield/wait. */
    return MN_UNIT;
  }

  if (t->waiting_on != NULL) {
    MnWaitCell *c = t->waiting_on;
    t->waiting_on = NULL;
    if (c->waiter == t) {
      c->waiter = NULL;
    }
  }

  finish_task(t, MN_TASK_CANCELLED, MN_UNIT);

  if (current != NULL && current->is_main && host_ctx == NULL) {
    pump();
  }
  return MN_UNIT;
}
