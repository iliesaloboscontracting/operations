// RT-007 (security retest, Ilies approved 27 Oct 2026): a chat alert is a nice-to-have, never part of saving the
// message. The claim (the "one alert per 2 minutes" bookkeeping, a database write that can hit SQLITE_BUSY when two
// posts collide) and the push both run inside this one guard: anything that fails means "no alert", logged, and the
// message the person sent still answers 201 - so nobody is told it failed and sends it again.
// No server imports; `npm test` (rules.test.ts).
export async function alertSafely(
  claim: () => Promise<number>,
  push: () => Promise<unknown>,
  log: (msg: string, e: unknown) => void = (m, e) => console.error(m, e),
): Promise<boolean> {
  try {
    if (!(await claim())) return false;
    await push();
    return true;
  } catch (e) {
    log("message alert failed", e);
    return false;
  }
}
