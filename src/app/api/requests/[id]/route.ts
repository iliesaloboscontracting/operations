import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addEvent, officeView } from "@/lib/siteRequests";
import { PRIORITIES, type Priority } from "@/lib/requestTypes";
import { suggestInBackground, suggestReminder } from "@/lib/requestReminders";

// PATCH /api/requests/:id - Ilies deciding on a site request. Admin only:
// Alex (and any other Manager) can see requests but never decides on them.
//   SEEN                                        - opened (only moves SENT -> SEEN)
//   APPROVE { assigneeId, note?, priority?, neededBy? } - onto that person's to-do
//   MINE    { note? }                           - Ilies is doing it himself
//   ASK     { question }                        - back to the supervisor for more info
//   DECLINE { reason }
//   DONE    { outcome }                         - closed by Ilies
//   REOPEN                                      - a closed one back to "to decide"
// Reminders (23 Oct 2026), on open requests:
//   REMIND { remindAt, note? }                  - set / move Ilies's reminder
//   CLEAR_REMINDER
//   ACCEPT_SUGGESTION { alsoNeededBy? }         - take the AI's suggested reminder
//                                                 (and its new needed-by, if ticked)
//   DISMISS_SUGGESTION
//   SUGGEST                                     - ask the AI now
const DECIDABLE = ["SENT", "SEEN", "NEEDS_INFO", "CANT_DO", "MINE", "TODO", "ACTIONING"];

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id } });
  if (!r) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const text = (x: unknown, max = 500) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const open = DECIDABLE.includes(r.status);
  let data: Record<string, unknown>;
  let note: string | null = null;

  switch (body.action) {
    case "SEEN":
      if (r.status !== "SENT") return done(r.id);
      data = { status: "SEEN", seenAt: new Date() };
      break;
    case "APPROVE": {
      if (!open) return bad("This one is closed - reopen it first.");
      const who = typeof body.assigneeId === "string"
        ? await prisma.resource.findUnique({ where: { id: body.assigneeId }, select: { id: true, name: true } })
        : null;
      if (!who) return bad("Pick who's doing it.");
      data = { status: "TODO", assigneeId: who.id, assigneeName: who.name, officeNote: text(body.note) || null, seenAt: r.seenAt ?? new Date(), outcome: null };
      if (body.priority !== undefined) {
        if (!PRIORITIES.includes(body.priority as Priority)) return bad("Pick a priority.");
        data.priority = body.priority;
      }
      if (body.neededBy) {
        const d = new Date(String(body.neededBy));
        if (Number.isNaN(d.getTime())) return bad("Pick a do-by time.");
        data.neededBy = d;
      }
      note = [`To ${who.name}`, text(body.note)].filter(Boolean).join(" - ");
      break;
    }
    case "MINE":
      if (!open) return bad("This one is closed - reopen it first.");
      data = { status: "MINE", assigneeId: null, assigneeName: null, officeNote: text(body.note) || r.officeNote, seenAt: r.seenAt ?? new Date() };
      note = text(body.note) || null;
      break;
    case "ASK": {
      if (!open) return bad("This one is closed - reopen it first.");
      const question = text(body.question, 300);
      if (question.length < 2) return bad("Type the question for the supervisor.");
      data = { status: "NEEDS_INFO", question, answer: null, seenAt: r.seenAt ?? new Date() };
      note = question;
      break;
    }
    case "DECLINE": {
      if (!open) return bad("This one is already closed.");
      const reason = text(body.reason, 300);
      if (reason.length < 2) return bad("Say why - the supervisor will see it.");
      data = { status: "DECLINED", declineReason: reason, seenAt: r.seenAt ?? new Date() };
      note = reason;
      break;
    }
    case "DONE": {
      if (!open) return bad("This one is already closed.");
      const outcome = text(body.outcome);
      if (outcome.length < 2) return bad("Say what was done - the supervisor will see it.");
      data = { status: "DONE", outcome, doneAt: new Date() };
      note = outcome;
      break;
    }
    case "REMIND": {
      if (!open) return bad("This one is closed.");
      const at = new Date(String(body.remindAt ?? ""));
      if (Number.isNaN(at.getTime())) return bad("Pick when to be reminded.");
      if (at.getTime() < Date.now() - 60_000) return bad("That time has already passed.");
      data = { remindAt: at, remindNote: text(body.note, 120) || null, remindedAt: null };
      note = [whenSyd(at), text(body.note, 120)].filter(Boolean).join(" - ");
      break;
    }
    case "CLEAR_REMINDER":
      data = { remindAt: null, remindNote: null, remindedAt: null };
      break;
    case "ACCEPT_SUGGESTION": {
      if (!open) return bad("This one is closed.");
      const s = r.aiSuggestion ? (JSON.parse(r.aiSuggestion) as { remindAt: string; note: string; newNeededBy: string | null }) : null;
      if (!s) return bad("There's no suggestion to accept.");
      const at = new Date(s.remindAt);
      if (at.getTime() < Date.now() - 60_000) return bad("That suggested time has passed - set a new one.");
      data = { remindAt: at, remindNote: s.note || null, remindedAt: null, aiSuggestion: null };
      if (body.alsoNeededBy && s.newNeededBy) data.neededBy = new Date(s.newNeededBy);
      note = [`${whenSyd(at)} - ${s.note}`, body.alsoNeededBy && s.newNeededBy ? `needed by moved to ${whenSyd(new Date(s.newNeededBy))}` : ""].filter(Boolean).join("; ");
      break;
    }
    case "DISMISS_SUGGESTION":
      data = { aiSuggestion: null };
      break;
    case "SUGGEST": {
      if (!open) return bad("This one is closed.");
      const s = await suggestReminder(r.id).catch(() => null);
      if (!s) return bad("No suggestion this time - set the reminder yourself.");
      return done(r.id);
    }
    case "REOPEN":
      if (open) return bad("This one is still open.");
      data = { status: "SEEN", doneAt: null };
      break;
    default:
      return bad("Unknown action.");
  }
  await prisma.siteRequest.update({ where: { id: r.id }, data });
  if (body.action !== "DISMISS_SUGGESTION") await addEvent(r.id, EVENT_NAME[body.action] ?? body.action, user.name, note);
  // A decision with a note can change when things happen - re-read the thread.
  if (["APPROVE", "MINE", "ASK"].includes(body.action)) suggestInBackground(r.id);
  return done(r.id);
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const EVENT_NAME: Record<string, string> = { REMIND: "REMINDER", ACCEPT_SUGGESTION: "REMINDER", CLEAR_REMINDER: "REMINDER_CLEARED" };
const whenSyd = (d: Date) =>
  d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
async function done(id: string) {
  const r = await prisma.siteRequest.findUnique({ where: { id }, include: { events: { orderBy: { at: "asc" } } } });
  return NextResponse.json({ request: officeView(r!) });
}
