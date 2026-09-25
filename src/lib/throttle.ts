// Tiny in-memory login throttle: after MAX failures within WINDOW, that key is locked
// until the window passes. Resets when the server restarts (fine for a single-server app).
const MAX = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

export function isLocked(key: string) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return a.count >= MAX;
}

export function recordFailure(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

export function clearFailures(key: string) {
  attempts.delete(key);
}
