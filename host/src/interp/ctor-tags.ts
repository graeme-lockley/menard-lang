/**
 * Constructor tags for host `compare` — must match `builtin-ctor-tag-of` /
 * `user-ctor-tag-base` in `src/emit/lower.mnd` (declaration order).
 */

const USER_CTOR_TAG_BASE = 1000;

/** Builtin ctor → numeric tag (Nil=0 … Err=5, IoError/Spawn…). */
const BUILTIN_TAGS: ReadonlyMap<string, number> = new Map([
  ["Nil", 0],
  ["Cons", 1],
  ["None", 2],
  ["Some", 3],
  ["Ok", 4],
  ["Err", 5],
  ["NotFound", 20],
  ["Permission", 21],
  ["Exists", 22],
  ["IsADirectory", 23],
  ["NotADirectory", 24],
  ["InvalidPath", 25],
  ["TooLarge", 26],
  ["Other", 27],
  ["Timeout", 28],
  ["TlsVerifyFailed", 29],
  ["Exited", 30],
  ["Signalled", 31],
  ["SpawnOutput", 32],
  ["NotExecutable", 33],
  ["InvalidArgument", 34],
  ["TooManyArguments", 35],
  ["Unsupported", 36],
  ["TlsHandshakeFailed", 37],
]);

const userTags = new Map<string, number>();
let nextUserTag = USER_CTOR_TAG_BASE;

/** True when `name` already has a builtin tag. */
export function hasBuiltinCtorTag(name: string): boolean {
  return BUILTIN_TAGS.has(name);
}

/**
 * Register a user constructor in declaration order. Skips builtins and names
 * already registered (first wins, matching a stable process-wide table).
 */
export function registerUserCtor(name: string): void {
  if (BUILTIN_TAGS.has(name) || userTags.has(name)) return;
  userTags.set(name, nextUserTag);
  nextUserTag += 1;
}

/** Numeric tag used by host `compare` for variant constructors. */
export function ctorTag(name: string): number {
  const b = BUILTIN_TAGS.get(name);
  if (b !== undefined) return b;
  const u = userTags.get(name);
  if (u !== undefined) return u;
  // Late discovery: assign next tag so ad-hoc values still have a stable order.
  registerUserCtor(name);
  return userTags.get(name)!;
}

/** Test helper: clear user registrations (builtins unchanged). */
export function resetUserCtorTags(): void {
  userTags.clear();
  nextUserTag = USER_CTOR_TAG_BASE;
}
