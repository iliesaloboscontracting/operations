import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { addEvent, todoView } from "@/lib/siteRequests";
import { notifyRequestUpdate } from "@/lib/requestAlerts";
import { ON_TODO } from "@/lib/requestTypes";

// PATCH /api/site/:token/todo/:id - the person actioning a request (Alex):
//   { action: "START" }               - "I'm on it" (supervisor sees it)
//   { action: "UPDATE", note }        - a progress note (supervisor sees it)
//   { action: "ASK", question }       - a question to the supervisor; their
//                                       answer comes back to this list
//   { action: "DONE", outcome }       - done, with what was booked
//   { action: "CANT_DO", reason }     - goes back to Ilies to decide again
// Alex doesn't decide - no declining or re-assigning from here (22 Oct 2026).
export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: { token: string; id: string } }) => {
  const link = await resolveLink(params.token);
  if (!link || link.kind !== "OFFICE" || !link.person.id) return NextResponse.json({ error: "No to-do list on this link." }, { status: 404 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id } });
  if (!r || r.assigneeId !== link.person.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!ON_TODO.includes(r.status)) return NextResponse.json({ error: "This one isn't on your list any more." }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const raw = [body.note, body.question, body.outcome, body.reason].find((x) => typeof x === "string") ?? "";
  const note = String(raw).trim().slice(0, 500);
  const who = link.person.name;
  let data: Record<string, unknown>;
  let what: string;

  switch (body.action) {
    case "START":
      if (r.status !== "TODO") return bad("You've already started this one.");
      data = { status: "ACTIONING" };
      what = `${who} is on it`;
      await addEvent(r.id, "STARTED", who, null);
      break;
    case "UPDATE":
      if (note.length < 2) return bad("Type the update.");
      data = r.status === "TODO" ? { status: "ACTIONING" } : {};
      what = `${who}: ${note}`;
      await addEvent(r.id, "UPDATE", who, note);
      break;
    case "ASK":
      if (r.status === "NEEDS_INFO") return bad("There's already a question waiting on the supervisor.");
      if (note.length < 2) return bad("Type the question for the supervisor.");
      data = { status: "NEEDS_INFO", question: note.slice(0, 300), answer: null };
      what = `${who} asked the supervisor: ${note}`;
      await addEvent(r.id, "ASK", who, note);
      break;
    case "DONE":
      if (note.length < 2) return bad('Say what was done - e.g. "Booked with Coates, arriving 7am".');
      data = { status: "DONE", outcome: note, doneAt: new Date() };
      what = `${who}: done - ${note}`;
      await addEvent(r.id, "DONE", who, note);
      break;
    case "CANT_DO":
      if (note.length < 2) return bad("Say why it can't be done.");
      data = { status: "CANT_DO", outcome: note };
      what = `${who} can't do it: ${note}`;
      await addEvent(r.id, "CANT_DO", who, note);
      break;
    default:
      return bad("Unknown action.");
  }
  const updated = await prisma.siteRequest.update({ where: { id: r.id }, data, include: { events: { orderBy: { at: "asc" } } } });
  await notifyRequestUpdate(updated, what);
  return NextResponse.json({ request: todoView(updated) });
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
