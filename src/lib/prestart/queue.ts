// The pre-start writes, one after another (moved here from store.ts on 10 Nov 2026 so plant.ts can use it too - PS-018).
// SQLite lets one writer in at a time, and two interactive transactions that overlap can time out on each other's locks
// (seen with 30 photos at once). Production is one server process, so these writes go one after another here - each
// still counts inside its own transaction, so the limits hold even if two ever did overlap.
const queue = globalThis as unknown as { __prestartQueue?: Promise<unknown>; __prestartWaiting?: number; __prestartEnqueued?: number };
export function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  queue.__prestartWaiting = (queue.__prestartWaiting ?? 0) + 1;
  queue.__prestartEnqueued = (queue.__prestartEnqueued ?? 0) + 1;
  const done = () => { queue.__prestartWaiting = Math.max(0, (queue.__prestartWaiting ?? 1) - 1); };
  const run = (queue.__prestartQueue ?? Promise.resolve()).then(fn, fn).finally(done);
  queue.__prestartQueue = run.catch(() => undefined);
  return run;
}
// PS-009: how many writes are waiting their turn - over LIMITS.queueWaiting a photo is turned away (503) at once.
export const queueWaiting = () => queue.__prestartWaiting ?? 0;
// How many writes have ever taken a place in the queue in this process - read by the release check (PS-022).
export const queueStats = () => ({ waiting: queue.__prestartWaiting ?? 0, enqueued: queue.__prestartEnqueued ?? 0 });
// Interactive transactions wait their turn rather than failing under a burst.
export const TX = { maxWait: 15_000, timeout: 15_000 };
