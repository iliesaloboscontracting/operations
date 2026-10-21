// Labour hire sign-ins reconciled against the board (21 Oct 2026, Ilies):
// a hire worker who signs in on a site with the QR fills one of the labour
// hire tiles allocated to that job that day. Worked out when it's shown, not
// stored, so it applies to past days too and follows the board if a tile is
// moved. Rules, in order:
//   1. a named agency worker on the board is matched by name;
//   2. everyone else fills the numbered tiles in sign-in order (first in =
//      the lowest number), then any named tile left over;
//   3. the same person signing in again on that job keeps their tile.
// Anyone left over had no labour hire tile there - flagged on Sign-ins.
import { QUICK_LABOUR_HIRE_NAME } from "./resource";

export type HireTile = { id: string; name: string };
export type HireSignIn = { id: string; workerName: string; company: string | null; signInAt: Date | string; status: string };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tileNo = (t: HireTile) => Number(QUICK_LABOUR_HIRE_NAME.exec(t.name)?.[1] ?? NaN);

// attendance id -> the labour hire tile it fills (missing = no tile left).
export function matchHireSignIns(tiles: HireTile[], signIns: HireSignIn[]): Map<string, HireTile> {
  const out = new Map<string, HireTile>();
  const free = new Map(tiles.map((t) => [t.id, t]));
  const byWorker = new Map<string, HireTile>();
  const take = (a: HireSignIn, t: HireTile) => {
    out.set(a.id, t);
    free.delete(t.id);
    byWorker.set(`${norm(a.workerName)}|${norm(a.company)}`, t);
  };
  const live = signIns
    .filter((a) => a.status !== "REJECTED")
    .sort((a, b) => new Date(a.signInAt).getTime() - new Date(b.signInAt).getTime());

  // 1. Named agency workers on the board, by name.
  for (const a of live) {
    const t = [...free.values()].find((x) => Number.isNaN(tileNo(x)) && norm(x.name) === norm(a.workerName));
    if (t) take(a, t);
  }
  // 2 + 3. Everyone else in sign-in order; a returning worker keeps theirs.
  const numbered = () => [...free.values()].filter((x) => !Number.isNaN(tileNo(x))).sort((x, y) => tileNo(x) - tileNo(y));
  for (const a of live) {
    if (out.has(a.id)) continue;
    const mine = byWorker.get(`${norm(a.workerName)}|${norm(a.company)}`);
    if (mine) {
      out.set(a.id, mine);
      continue;
    }
    const t = numbered()[0] ?? [...free.values()][0];
    if (t) take(a, t);
  }
  return out;
}
