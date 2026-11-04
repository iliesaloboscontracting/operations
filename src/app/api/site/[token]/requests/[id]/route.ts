import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { addEvent, askedByAssignee, linkVisible, siteView } from "@/lib/siteRequests";
import { notifyRequestUpdate } from "@/lib/requestAlerts";
import { suggestInBackground } from "@/lib/requestReminders";
import { isWithYard } from "@/lib/yard/rules";
import { notifyYard } from "@/lib/yard/alerts";
import { CHANGED, applyYardAction, moveIfStill } from "@/lib/yard/store";

// PATCH /api/site/:token/requests/:id
//   { action: "ANSWER", answer }  - reply to the office's question
//   { action: "CANCEL", reason? } - no longer needed (until it's done)
//   { action: "COLLECTED" }       - picked up from the yard (only once it's ready; 4 Nov 2026)
// Only the link that sent it (or the same supervisor's other link).
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link || link.kind === "OFFICE") return NextResponse.json({ error: "This link isn't active." }, { status: 404 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id }, include: { events: { orderBy: { at: "asc" } } } });
  const mine = r && (r.siteLinkId === link.id || (!link.shared && link.person.id && r.requestedById === link.person.id));
  if (!r || !mine || !linkVisible(r)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const text = (x: unknown) => (typeof x === "string" ? x.trim().slice(0, 500) : "");

  if (body.action === "ANSWER") {
    if (r.status !== "NEEDS_INFO") return bad("The office isn't waiting on an answer for this one.");
    const answer = text(body.answer);
    if (answer.length < 2) return bad("Type your answer.");
    // Back to whoever asked: the person actioning it (Alex), or the office.
    const status = askedByAssignee(r) ? "ACTIONING" : "SEEN";
    await prisma.siteRequest.update({ where: { id: r.id }, data: { answer, status } });
    await addEvent(r.id, "ANSWERED", link.person.name, answer);
    const updated = (await prisma.siteRequest.findUnique({ where: { id: r.id }, include: { events: { orderBy: { at: "asc" } } } }))!;
    await notifyRequestUpdate(updated, `${link.person.name} answered: ${answer}`);
    suggestInBackground(r.id); // the answer may move when it's needed
    return NextResponse.json({ request: siteView(updated) });
  }
  if (body.action === "CANCEL") {
    if (["DONE", "DECLINED", "CANCELLED"].includes(r.status)) return bad("This one is already closed.");
    // YD-003 (Ilies approved 4 Nov 2026): a job the yard has may be marked ready / collected at the same
    // moment - cancel only if it's still where it was (else 409, nothing written, no alert).
    if (isWithYard(r.status)) {
      if (!(await moveIfStill(prisma, r.id, r.status, { status: "CANCELLED" }))) return NextResponse.json({ error: CHANGED.error }, { status: CHANGED.status });
    } else await prisma.siteRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
    await addEvent(r.id, "CANCELLED", link.person.name, text(body.reason) || null);
    const updated = (await prisma.siteRequest.findUnique({ where: { id: r.id }, include: { events: { orderBy: { at: "asc" } } } }))!;
    await notifyRequestUpdate(updated, `${link.person.name} cancelled it - no longer needed`);
    // The yard was getting it ready - tell them to stop (4 Nov 2026).
    if (isWithYard(r.status)) await notifyYard(updated, `Cancelled by ${link.person.name} - no longer needed`);
    return NextResponse.json({ request: siteView(updated) });
  }
  // Yard jobs (Ilies, 4 Nov 2026): the supervisor picked up what the yard got ready.
  if (body.action === "COLLECTED") {
    const out = await applyYardAction(r, "COLLECTED", { by: link.person.name });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    const updated = (await prisma.siteRequest.findUnique({ where: { id: r.id }, include: { events: { orderBy: { at: "asc" } } } }))!;
    return NextResponse.json({ request: siteView(updated) });
  }
  return bad("Unknown action.");
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
