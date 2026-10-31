/*
 * Cooperative single-mutator task runtime (Build D/E).
 *
 * Native: task-local fiber stacks (ucontext). Menard values live in
 * per-task shadow stacks (GC). Pump model: join/resume/yield drive
 * runnable fibers via a host context on the caller's stack.
 *
 * Wait cells provide the atomic-wait guarantee (notify-before-wait does
 * not lose a wakeup). Multi-waiter FIFO; notify wakes at most one.
 * notify_all marks the cell closed and wakes every waiter (Mailbox.close).
 * Cancel of a wait-cell waiter soft-resumes so mn_task_wait returns Err.
 * Public Platform API is std/task; this file is the Runtime ABI behind it.
 */
#define _XOPEN_SOURCE 700

#include "gc_internal.h"
#include "menard.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>
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
  int closed; /* set by notify_all; wait never parks on a closed cell */
  struct MnTask *waiters_head;
  struct MnTask *waiters_tail;
  struct MnWaitCell *next;
} MnWaitCell;

typedef struct MnDeferEntry {
  MnWord clo;
  int depth;
  struct MnDeferEntry *next;
} MnDeferEntry;

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
  struct MnTask *wait_next; /* next in a wait-cell FIFO */
  struct MnTask *join_waiter;
  struct MnTask *next_runnable;
  struct MnTask *all_next;
  MnDeferEntry *defers; /* newest first */
  int defer_depth;
  int running_defers; /* reentrancy guard while applying cleanups */
  int wait_timed_out; /* set by timer fire; consumed by wait_until */
} MnTask;

typedef struct MnTimer {
  int64_t deadline; /* mono ms */
  MnTask *task;
  MnWaitCell *cell;
  int alive;
} MnTimer;

#define MN_TIMER_CAP 256

static MnTask *all_tasks = NULL;
static int next_id = 1;

static MnWaitCell *all_cells = NULL;
static int next_cell_id = 1;

static MnTimer timers[MN_TIMER_CAP];
static int timer_count = 0;

typedef struct MnDictEntry {
  MnWord key;
  MnWord value;
  struct MnDictEntry *next;
} MnDictEntry;

static MnDictEntry *dict_head = NULL;

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
static void notify_all_cell(MnWaitCell *c);
static void finish_task(MnTask *t, MnTaskStatus st, MnWord result);
static int is_terminal(MnTask *t);
static void waiter_enqueue(MnWaitCell *c, MnTask *t);
static void waiter_unlink(MnWaitCell *c, MnTask *t);
static int wait_on_cell(MnWaitCell *c);
static int wait_on_cell_until(MnWaitCell *c, int64_t deadline_mono);
static void run_defers_all(MnTask *t);
static void run_defers_leave(MnTask *t);
static void timer_arm(MnTask *t, MnWaitCell *c, int64_t deadline);
static void timer_disarm_task(MnTask *t);
static void idle_block(int timeout_ms);

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

static void waiter_enqueue(MnWaitCell *c, MnTask *t) {
  t->wait_next = NULL;
  if (c->waiters_tail == NULL) {
    c->waiters_head = c->waiters_tail = t;
  } else {
    c->waiters_tail->wait_next = t;
    c->waiters_tail = t;
  }
}

static void waiter_unlink(MnWaitCell *c, MnTask *t) {
  MnTask *prev = NULL;
  for (MnTask *p = c->waiters_head; p != NULL; p = p->wait_next) {
    if (p == t) {
      if (prev == NULL) {
        c->waiters_head = t->wait_next;
      } else {
        prev->wait_next = t->wait_next;
      }
      if (c->waiters_tail == t) {
        c->waiters_tail = prev;
      }
      t->wait_next = NULL;
      return;
    }
    prev = p;
  }
}

static void wake_one_waiter(MnWaitCell *c, MnTask *w) {
  (void)c;
  w->wait_next = NULL;
  w->waiting_on = NULL;
  if (!w->is_main) {
    enqueue(w);
  }
}

static void notify_cell(MnWaitCell *c) {
  if (c == NULL) {
    return;
  }
  c->notified = 1;
  if (c->waiters_head != NULL) {
    MnTask *w = c->waiters_head;
    c->waiters_head = w->wait_next;
    if (c->waiters_head == NULL) {
      c->waiters_tail = NULL;
    }
    c->notified = 0; /* consumed by the woken waiter */
    wake_one_waiter(c, w);
  }
}

/* Close the cell and wake every waiter. Sticky/closed stay set so a late
 * wait after an alive-check/park race returns without parking. */
static void notify_all_cell(MnWaitCell *c) {
  if (c == NULL) {
    return;
  }
  c->closed = 1;
  c->notified = 1;
  while (c->waiters_head != NULL) {
    MnTask *w = c->waiters_head;
    c->waiters_head = w->wait_next;
    if (c->waiters_head == NULL) {
      c->waiters_tail = NULL;
    }
    wake_one_waiter(c, w);
  }
}

static void run_one_defer(MnTask *t, MnDeferEntry *e) {
  MnWord clo;
  mn_root_push(&clo);
  clo = e->clo;
  (void)mn_apply_0(clo);
  mn_root_pop();
  free(e);
  (void)t;
}

static void run_defers_leave(MnTask *t) {
  if (t == NULL || t->running_defers) {
    return;
  }
  t->running_defers = 1;
  int depth = t->defer_depth;
  while (t->defers != NULL && t->defers->depth == depth) {
    MnDeferEntry *e = t->defers;
    t->defers = e->next;
    run_one_defer(t, e);
  }
  if (t->defer_depth > 0) {
    t->defer_depth--;
  }
  t->running_defers = 0;
}

static void run_defers_all(MnTask *t) {
  if (t == NULL || t->running_defers) {
    return;
  }
  t->running_defers = 1;
  while (t->defers != NULL) {
    MnDeferEntry *e = t->defers;
    t->defers = e->next;
    run_one_defer(t, e);
  }
  t->defer_depth = 0;
  t->running_defers = 0;
}

static void finish_task(MnTask *t, MnTaskStatus st, MnWord result) {
  /* Cancel (and any finish) runs remaining defers before notifying joiners.
   * Activate t so cleanups see the correct mn_task_self / park context. */
  MnTask *saved = current;
  current = t;
  run_defers_all(t);
  current = saved;
  t->result = result;
  t->status = st;
  t->cancel_requested = 0;
  notify_cell(t->done_cell);
  wake_joiner(t);
}

/* Park; resume returns to caller. Cancel of wait-cell waiters is soft
 * (caller sees cancel_requested). Hard cancel never resumes. */
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

int64_t mn_mono_now_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
    return 0;
  }
  return (int64_t)ts.tv_sec * 1000 + (int64_t)ts.tv_nsec / 1000000;
}

MnWord mn_mono_ms(void) {
  return mn_int_to_word(mn_mono_now_ms());
}

static void timer_arm(MnTask *t, MnWaitCell *c, int64_t deadline) {
  timer_disarm_task(t);
  if (timer_count >= MN_TIMER_CAP) {
    mn_panic("mn_task: timer table full");
  }
  int i = timer_count++;
  timers[i].deadline = deadline;
  timers[i].task = t;
  timers[i].cell = c;
  timers[i].alive = 1;
  /* Bubble up min-heap by deadline. */
  while (i > 0) {
    int p = (i - 1) / 2;
    if (timers[p].deadline <= timers[i].deadline) {
      break;
    }
    MnTimer tmp = timers[p];
    timers[p] = timers[i];
    timers[i] = tmp;
    i = p;
  }
}

static void timer_heap_remove_at(int i) {
  if (i < 0 || i >= timer_count) {
    return;
  }
  timers[i] = timers[timer_count - 1];
  timer_count--;
  if (i >= timer_count) {
    return;
  }
  /* Sift down. */
  for (;;) {
    int l = 2 * i + 1;
    int r = 2 * i + 2;
    int smallest = i;
    if (l < timer_count && timers[l].deadline < timers[smallest].deadline) {
      smallest = l;
    }
    if (r < timer_count && timers[r].deadline < timers[smallest].deadline) {
      smallest = r;
    }
    if (smallest == i) {
      break;
    }
    MnTimer tmp = timers[i];
    timers[i] = timers[smallest];
    timers[smallest] = tmp;
    i = smallest;
  }
}

static void timer_disarm_task(MnTask *t) {
  for (int i = 0; i < timer_count;) {
    if (timers[i].alive && timers[i].task == t) {
      timer_heap_remove_at(i);
      continue;
    }
    i++;
  }
}

void mn_timers_fire_due(void) {
  int64_t now = mn_mono_now_ms();
  while (timer_count > 0 && timers[0].alive && timers[0].deadline <= now) {
    MnTimer fired = timers[0];
    timer_heap_remove_at(0);
    MnTask *t = fired.task;
    MnWaitCell *c = fired.cell;
    if (t == NULL || c == NULL) {
      continue;
    }
    if (t->waiting_on != c) {
      continue; /* already woken */
    }
    waiter_unlink(c, t);
    t->waiting_on = NULL;
    t->wait_timed_out = 1;
    if (!t->is_main) {
      enqueue(t);
    }
  }
}

int mn_timers_delay_ms(void) {
  if (timer_count == 0 || !timers[0].alive) {
    return -1;
  }
  int64_t now = mn_mono_now_ms();
  int64_t d = timers[0].deadline - now;
  if (d <= 0) {
    return 0;
  }
  if (d > 2147483647) {
    return 2147483647;
  }
  return (int)d;
}

static void idle_block(int timeout_ms) {
  if (timeout_ms < 0) {
    (void)mn_net_poll(-1);
    return;
  }
  if (timeout_ms == 0) {
    (void)mn_net_poll(0);
    return;
  }
  if (mn_net_poll(timeout_ms) > 0) {
    return;
  }
}

static void pump(void) {
  for (;;) {
    mn_timers_fire_due();
    MnTask *t = dequeue();
    if (t == NULL) {
      if (mn_net_poll(0) > 0) {
        continue;
      }
      mn_timers_fire_due();
      if (runnable_head != NULL) {
        continue;
      }
      return;
    }
    run_one(t);
  }
}

/* Atomic wait: 0 = notified, 1 = cancelled. Single-mutator — no Menard
 * between check and park. A closed cell never parks. */
static int wait_on_cell(MnWaitCell *c) {
  MnTask *self = current;
  if (self->cancel_requested || self->status == MN_TASK_CANCELLED) {
    return 1;
  }
  if (c->closed) {
    return 0;
  }
  if (c->notified) {
    c->notified = 0;
    return 0;
  }
  if (self->is_main) {
    while (!c->notified && !c->closed) {
      if (self->cancel_requested) {
        return 1;
      }
      mn_timers_fire_due();
      if (runnable_head != NULL) {
        pump();
        continue;
      }
      int delay = mn_timers_delay_ms();
      if (delay == 0) {
        continue;
      }
      idle_block(delay);
      mn_timers_fire_due();
      if (c->notified || c->closed) {
        break;
      }
      if (runnable_head != NULL) {
        continue;
      }
      if (delay < 0) {
        mn_panic("mn_task_wait: main stuck");
      }
    }
    if (self->cancel_requested) {
      return 1;
    }
    if (c->closed) {
      return 0;
    }
    c->notified = 0;
    return 0;
  }
  waiter_enqueue(c, self);
  self->waiting_on = c;
  park_current();
  self->waiting_on = NULL;
  timer_disarm_task(self);
  if (self->cancel_requested || self->status == MN_TASK_CANCELLED) {
    return 1;
  }
  if (c->closed) {
    return 0;
  }
  c->notified = 0;
  return 0;
}

/* 0 = notified/closed, 1 = cancelled, 2 = timed out. */
static int wait_on_cell_until(MnWaitCell *c, int64_t deadline_mono) {
  MnTask *self = current;
  self->wait_timed_out = 0;
  if (self->cancel_requested || self->status == MN_TASK_CANCELLED) {
    return 1;
  }
  if (c->closed) {
    return 0;
  }
  if (c->notified) {
    c->notified = 0;
    return 0;
  }
  if (mn_mono_now_ms() >= deadline_mono) {
    return 2;
  }
  if (self->is_main) {
    while (!c->notified && !c->closed) {
      if (self->cancel_requested) {
        return 1;
      }
      if (mn_mono_now_ms() >= deadline_mono) {
        return 2;
      }
      mn_timers_fire_due();
      if (self->wait_timed_out) {
        self->wait_timed_out = 0;
        return 2;
      }
      if (runnable_head != NULL) {
        pump();
        continue;
      }
      int64_t now = mn_mono_now_ms();
      int64_t left = deadline_mono - now;
      if (left <= 0) {
        return 2;
      }
      int delay = mn_timers_delay_ms();
      int block_ms = (int)left;
      if (delay >= 0 && delay < block_ms) {
        block_ms = delay;
      }
      idle_block(block_ms);
      mn_timers_fire_due();
      if (self->wait_timed_out) {
        self->wait_timed_out = 0;
        return 2;
      }
    }
    if (self->cancel_requested) {
      return 1;
    }
    if (c->closed) {
      return 0;
    }
    c->notified = 0;
    return 0;
  }
  waiter_enqueue(c, self);
  self->waiting_on = c;
  timer_arm(self, c, deadline_mono);
  park_current();
  self->waiting_on = NULL;
  timer_disarm_task(self);
  if (self->wait_timed_out) {
    self->wait_timed_out = 0;
    return 2;
  }
  if (self->cancel_requested || self->status == MN_TASK_CANCELLED) {
    return 1;
  }
  if (c->closed) {
    return 0;
  }
  c->notified = 0;
  return 0;
}

void mn_task_visit_roots(mn_root_visit_fn fn, void *ctx) {
  for (MnTask *t = all_tasks; t != NULL; t = t->all_next) {
    fn(&t->closure, ctx);
    fn(&t->result, ctx);
    for (MnDeferEntry *d = t->defers; d != NULL; d = d->next) {
      fn(&d->clo, ctx);
    }
  }
  for (MnDictEntry *e = dict_head; e != NULL; e = e->next) {
    fn(&e->key, ctx);
    fn(&e->value, ctx);
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
  if (current->cancel_requested || current->status == MN_TASK_CANCELLED) {
    finish_task(current, MN_TASK_CANCELLED, MN_UNIT);
    if (host_ctx == NULL) {
      mn_panic("mn_task: cancelled with no host");
    }
    swapcontext(&current->ctx, host_ctx);
    mn_panic("mn_task: resume after cancel");
  }
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
  if (self->cancel_requested || self->status == MN_TASK_CANCELLED) {
    finish_task(self, MN_TASK_CANCELLED, MN_UNIT);
    if (host_ctx == NULL) {
      mn_panic("mn_task: cancelled with no host");
    }
    swapcontext(&self->ctx, host_ctx);
    mn_panic("mn_task: resume after cancel");
  }
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
  MnWord out;
  mn_root_push(&out);
  if (wait_on_cell(c) != 0) {
    out = mn_err(MN_UNIT);
  } else {
    out = mn_ok(MN_UNIT);
  }
  mn_root_pop();
  return out;
}

MnWord mn_task_wait_until(MnWord cell_tagged, MnWord deadline_mono) {
  ensure_main_task();
  int id = (int)mn_word_to_int(cell_tagged);
  MnWaitCell *c = cell_by_id(id);
  if (c == NULL) {
    mn_panic("mn_task_wait_until: bad cell");
  }
  int64_t deadline = mn_word_to_int(deadline_mono);
  int rc = wait_on_cell_until(c, deadline);
  MnWord out;
  mn_root_push(&out);
  if (rc == 0) {
    out = mn_ok(MN_UNIT);
  } else if (rc == 1) {
    out = mn_err(mn_int_to_word(0)); /* cancel */
  } else {
    out = mn_err(mn_int_to_word(1)); /* timeout */
  }
  mn_root_pop();
  return out;
}

MnWord mn_task_sleep_ms(MnWord ms_tagged) {
  ensure_main_task();
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  MnWaitCell *c = alloc_cell();
  int64_t deadline = mn_mono_now_ms() + ms;
  int rc = wait_on_cell_until(c, deadline);
  MnWord out;
  mn_root_push(&out);
  if (rc == 1) {
    out = mn_err(MN_UNIT);
  } else {
    out = mn_ok(MN_UNIT); /* timeout or notify both complete the sleep */
  }
  mn_root_pop();
  return out;
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

MnWord mn_task_notify_all(MnWord cell_tagged) {
  ensure_main_task();
  int id = (int)mn_word_to_int(cell_tagged);
  MnWaitCell *c = cell_by_id(id);
  if (c == NULL) {
    mn_panic("mn_task_notify_all: bad cell");
  }
  notify_all_cell(c);
  if (current != NULL && current->is_main && host_ctx == NULL) {
    pump();
  }
  return MN_UNIT;
}

static void join_abort_self(void) {
  MnTask *self = current;
  finish_task(self, MN_TASK_CANCELLED, MN_UNIT);
  if (self->is_main) {
    mn_panic("mn_task_join: main cancelled");
  }
  if (host_ctx == NULL) {
    mn_panic("mn_task: cancelled with no host");
  }
  swapcontext(&self->ctx, host_ctx);
  mn_panic("mn_task: resume after cancel");
}

static void join_wait_until_terminal(MnTask *target) {
  MnTask *self = current;
  target->join_waiter = self;

  if (self->is_main) {
    while (!is_terminal(target)) {
      if (self->cancel_requested) {
        target->join_waiter = NULL;
        join_abort_self();
      }
      if (runnable_head != NULL) {
        pump();
        continue;
      }
      if (!target->started || target->status == MN_TASK_RUNNABLE) {
        enqueue(target);
        pump();
        continue;
      }
      if (target->status == MN_TASK_SUSPENDED && target->waiting_on == NULL) {
        /* Auto-resume synthetic parks (suspend-for-test / yield) only.
         * Wait-cell waiters must be woken by notify/cancel — not join. */
        enqueue(target);
        pump();
        continue;
      }
      if (target->status == MN_TASK_SUSPENDED && target->waiting_on != NULL) {
        /* Target is parked on a wait cell — pump others; drive I/O/timers. */
        if (runnable_head != NULL) {
          pump();
          continue;
        }
        mn_timers_fire_due();
        int delay = mn_timers_delay_ms();
        idle_block(delay);
        mn_timers_fire_due();
        if (runnable_head != NULL || is_terminal(target)) {
          continue;
        }
        if (delay < 0) {
          mn_panic("mn_task_join: target waiting on cell");
        }
        continue;
      }
      mn_panic("mn_task_join: stuck");
    }
  } else {
    while (!is_terminal(target)) {
      if (target->status == MN_TASK_SUSPENDED && runnable_head == NULL) {
        enqueue(target);
      }
      if (wait_on_cell(target->done_cell) != 0) {
        target->join_waiter = NULL;
        join_abort_self();
      }
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

MnWord mn_task_join_timeout(MnWord id_tagged, MnWord ms_tagged) {
  ensure_main_task();
  int id = (int)mn_word_to_int(id_tagged);
  MnTask *target = task_by_id(id);
  if (target == NULL) {
    mn_panic("mn_task_join_timeout: bad id");
  }
  int64_t ms = mn_word_to_int(ms_tagged);
  if (ms < 0) {
    ms = 0;
  }
  int64_t deadline = mn_mono_now_ms() + ms;

  MnWord out;
  mn_root_push(&out);

  if (is_terminal(target)) {
    MnWord inner;
    mn_root_push(&inner);
    if (target->status == MN_TASK_CANCELLED) {
      inner = mn_err(MN_UNIT);
    } else {
      inner = mn_ok(target->result);
    }
    out = mn_ok(inner);
    mn_root_pop();
    mn_root_pop();
    return out;
  }

  int rc = wait_on_cell_until(target->done_cell, deadline);
  if (rc == 2 && !is_terminal(target)) {
    /* Timed out; leave the task running. */
    out = mn_err((MnWord)&mn_static_timeout);
    mn_root_pop();
    return out;
  }
  if (rc == 1) {
    /* Caller cancelled while waiting — still surface join if terminal. */
    if (!is_terminal(target)) {
      out = mn_err((MnWord)&mn_static_timeout);
      mn_root_pop();
      return out;
    }
  }
  {
    MnWord inner;
    mn_root_push(&inner);
    if (target->status == MN_TASK_CANCELLED) {
      inner = mn_err(MN_UNIT);
    } else {
      inner = mn_ok(target->result);
    }
    out = mn_ok(inner);
    mn_root_pop();
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
    waiter_unlink(c, t);
    t->waiting_on = NULL;
    timer_disarm_task(t);
    /* Soft cancel: resume so mn_task_wait returns Err; do not consume sticky. */
    if (!t->is_main) {
      enqueue(t);
    }
    if (current != NULL && current->is_main && host_ctx == NULL) {
      pump();
    }
    return MN_UNIT;
  }

  finish_task(t, MN_TASK_CANCELLED, MN_UNIT);

  if (current != NULL && current->is_main && host_ctx == NULL) {
    pump();
  }
  return MN_UNIT;
}

static int dict_key_eq(MnWord a, MnWord b) {
  int64_t la = mn_word_to_int(mn_str_byte_length(a));
  int64_t lb = mn_word_to_int(mn_str_byte_length(b));
  if (la != lb) {
    return 0;
  }
  for (int64_t i = 0; i < la; i++) {
    if (mn_word_to_int(mn_str_byte(a, mn_int_to_word(i))) !=
        mn_word_to_int(mn_str_byte(b, mn_int_to_word(i)))) {
      return 0;
    }
  }
  return 1;
}

MnWord mn_task_dict_set(MnWord key_str, MnWord value) {
  ensure_main_task();
  MnWord k;
  MnWord v;
  mn_root_push(&k);
  mn_root_push(&v);
  k = key_str;
  v = value;
  for (MnDictEntry *e = dict_head; e != NULL; e = e->next) {
    if (dict_key_eq(e->key, k)) {
      e->value = v;
      mn_root_pop();
      mn_root_pop();
      return MN_UNIT;
    }
  }
  MnDictEntry *e = (MnDictEntry *)calloc(1, sizeof(MnDictEntry));
  if (e == NULL) {
    mn_panic("mn_task_dict_set: oom");
  }
  e->key = k;
  e->value = v;
  e->next = dict_head;
  dict_head = e;
  mn_root_pop();
  mn_root_pop();
  return MN_UNIT;
}

MnWord mn_task_dict_get(MnWord key_str) {
  ensure_main_task();
  for (MnDictEntry *e = dict_head; e != NULL; e = e->next) {
    if (dict_key_eq(e->key, key_str)) {
      return mn_some(e->value);
    }
  }
  return mn_none();
}

MnWord mn_task_defer_enter(void) {
  ensure_main_task();
  if (current == NULL) {
    mn_panic("mn_task_defer_enter: no current task");
  }
  current->defer_depth++;
  return MN_UNIT;
}

MnWord mn_task_defer_push(MnWord clo0) {
  ensure_main_task();
  if (current == NULL) {
    mn_panic("mn_task_defer_push: no current task");
  }
  MnWord held;
  mn_root_push(&held);
  held = clo0;
  MnDeferEntry *e = (MnDeferEntry *)calloc(1, sizeof(MnDeferEntry));
  if (e == NULL) {
    mn_panic("mn_task_defer_push: oom");
  }
  e->clo = held;
  e->depth = current->defer_depth;
  e->next = current->defers;
  current->defers = e;
  mn_root_pop();
  return MN_UNIT;
}

MnWord mn_task_defer_leave(void) {
  ensure_main_task();
  if (current == NULL) {
    mn_panic("mn_task_defer_leave: no current task");
  }
  run_defers_leave(current);
  return MN_UNIT;
}
