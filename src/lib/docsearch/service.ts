// LCI phase 6: wiring - which source to use, the kill switch, the nightly run (after 2:30am Sydney, after the backup
// and the Xero read), and an Admin's "Refresh now" (D6-4). Nothing here calls out unless Graph is set up.
import { graphSetup, NOT_SET_UP } from "./graphSetup";
import { GraphSource, realGraphFetch } from "./sources/graph";
import { LocalFolderSource } from "./sources/local";
import type { DocSource } from "./sources/types";
import { refreshIndex, type RunResult } from "./indexer";
import { getMeta, setMeta } from "./index";

export const switchedOff = () => (process.env.DOC_SEARCH ?? "").trim().toLowerCase() === "off";

// The source to read from, or why there isn't one. LocalFolderSource only when asked for, and never in production (D6-5).
export function pickSource(): { source: DocSource; approvedIds?: Set<string> } | { off: string } {
  if (switchedOff()) return { off: "Document search is switched off." };
  if ((process.env.DOC_SEARCH_SOURCE ?? "").trim() === "local") {
    if (process.env.NODE_ENV === "production") return { off: "The local test source can't run in production." };
    const root = (process.env.DOC_SEARCH_LOCAL_ROOT ?? "").trim();
    if (!root) return { off: "DOC_SEARCH_LOCAL_ROOT isn't set." };
    const ids = (process.env.DOC_SEARCH_TEST_APPROVE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return { source: new LocalFolderSource(root), approvedIds: ids.length ? new Set(ids) : undefined };
  }
  const s = graphSetup();
  if (!s.ok) return { off: s.reason === NOT_SET_UP ? NOT_SET_UP : s.reason };
  return { source: new GraphSource(s, realGraphFetch) };
}

let running = false;
export async function runRefresh(): Promise<RunResult | { off: string } | { busy: true }> {
  if (running) return { busy: true };
  const p = pickSource();
  if ("off" in p) return p;
  running = true;
  try {
    return await refreshIndex(p.source, p.approvedIds);
  } finally {
    running = false;
  }
}

const sydney = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
};

// From the instrumentation tick (every minute). Once a day from 2:30am Sydney. Does nothing when off / not set up -
// and never opens the index file then, so an unconfigured server never even creates it.
export async function nightlyDocIndex() {
  const p = pickSource();
  if ("off" in p || running) return;
  const now = sydney();
  if (now.minutes < 150) return;
  if (getMeta("nightly") === now.date) return;
  setMeta("nightly", now.date);
  const r = await runRefresh();
  if ("error" in r && r.error) console.error("document index", r.error);
}

// D6-4: an Admin's "Refresh now", at most every 15 minutes.
export async function refreshNow(): Promise<{ ok: true; result: RunResult } | { error: string; status: number }> {
  const p = pickSource();
  if ("off" in p) return { error: p.off, status: 400 };
  const last = getMeta("manual");
  if (last && Date.now() - Number(last) < 15 * 60_000) return { error: "Refreshed in the last 15 minutes - try again shortly.", status: 429 };
  setMeta("manual", String(Date.now()));
  const r = await runRefresh();
  if ("busy" in r) return { error: "A refresh is already running.", status: 409 };
  if ("off" in r) return { error: r.off, status: 400 };
  return { ok: true, result: r };
}
