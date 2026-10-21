// Site requests: telling Ilies's phone the moment something arrives or
// changes (Web Push - lib/push.ts). Urgent and High alert straight away,
// Low arrives silently; an Urgent one still unopened after 15 minutes
// alerts again (up to 3 times). Alert failures never stop a request saving.
import type { SiteRequest } from "@prisma/client";
import { prisma } from "./prisma";
import { pushToAdmins } from "./push";
import { NEEDS_ILIES, PRIORITY_DOT, PRIORITY_LABEL, requestNo, whenText, type Priority } from "./requestTypes";
import { addEvent } from "./siteRequests";

const urlOf = (r: SiteRequest) => `/requests?open=${r.id}`;

export async function notifyNewRequest(r: SiteRequest): Promise<void> {
  const p = r.priority as Priority;
  await pushToAdmins(
    {
      title: `${PRIORITY_DOT[p]} ${PRIORITY_LABEL[p]} request - ${r.siteLabel}`,
      body: `${r.summary}\n${r.requestedBy} · needed by ${whenText(r.neededBy)}`,
      url: urlOf(r),
      tag: `req-${r.number}`,
      silent: p === "LOW",
      sticky: p === "URGENT",
    },
    p === "LOW" ? "normal" : "high",
  ).catch((e) => console.error("request alert", e));
}

// Changes that need Ilies (an answer, "can't do") alert; the rest (done,
// cancelled) arrive silently.
export async function notifyRequestUpdate(r: SiteRequest, what: string): Promise<void> {
  const needsYou = NEEDS_ILIES.includes(r.status);
  await pushToAdmins(
    { title: `${requestNo(r.number)} · ${r.siteLabel}`, body: `${what}\n${r.summary}`, url: urlOf(r), tag: `req-${r.number}`, silent: !needsYou },
    needsYou ? "high" : "normal",
  ).catch((e) => console.error("request alert", e));
}

const REALERT_MINUTES = 15;
const MAX_REALERTS = 3;

// Run every minute (instrumentation.ts): Urgent requests not yet opened.
export async function realertUnopenedUrgent() {
  const due = new Date(Date.now() - REALERT_MINUTES * 60_000);
  const rows = await prisma.siteRequest.findMany({
    where: { priority: "URGENT", status: "SENT", createdAt: { lte: due } },
    include: { events: { where: { action: "REALERT" }, orderBy: { at: "desc" } } },
  });
  for (const r of rows) {
    if (r.events.length >= MAX_REALERTS) continue;
    if (r.events[0] && r.events[0].at > due) continue;
    const mins = Math.round((Date.now() - r.createdAt.getTime()) / 60_000);
    await pushToAdmins(
      { title: `🔴 Still not opened (${mins} min) - ${r.siteLabel}`, body: `${r.summary}\n${r.requestedBy} · needed by ${whenText(r.neededBy)}`, url: urlOf(r), tag: `req-${r.number}`, sticky: true },
      "high",
    ).catch((e) => console.error("request re-alert", e));
    await addEvent(r.id, "REALERT", "Operations", `Re-alerted after ${mins} min unopened`);
  }
}
