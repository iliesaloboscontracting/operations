import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { addEvent, todoView } from "@/lib/siteRequests";
import { notifyRequestUpdate } from "@/lib/requestAlerts";

// PATCH /api/site/:token/todo/:id
//   { action: "DONE", outcome }    - done, with what was booked / where it's at
//   { action: "CANT_DO", reason }  - goes back to Ilies to decide again
// Alex doesn't decide - he only reports back on what he was given.
export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: { token: string; id: string } }) => {
  const link = await resolveLink(params.token);
  if (!link || link.kind !== "OFFICE" || !link.person.id) return NextResponse.json({ error: "No to-do list on this link." }, { status: 404 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id } });
  if (!r || r.assigneeId !== link.person.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (r.status !== "TODO") return NextResponse.json({ error: "This one isn't on your list any more." }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const text = typeof body.outcome === "string" ? body.outcome : typeof body.reason === "string" ? body.reason : "";
  const note = text.trim().slice(0, 500);

  if (body.action === "DONE") {
    if (note.length < 2) return bad("Say what was done - e.g. \"Booked with Coates, arriving 7am\".");
    const updated = await prisma.siteRequest.update({ where: { id: r.id }, data: { status: "DONE", outcome: note, doneAt: new Date() } });
    await addEvent(r.id, "DONE", link.person.name, note);
    await notifyRequestUpdate(updated, `${link.person.name}: done - ${note}`);
    return NextResponse.json({ request: todoView(updated) });
  }
  if (body.action === "CANT_DO") {
    if (note.length < 2) return bad("Say why it can't be done.");
    const updated = await prisma.siteRequest.update({ where: { id: r.id }, data: { status: "CANT_DO", outcome: note } });
    await addEvent(r.id, "CANT_DO", link.person.name, note);
    await notifyRequestUpdate(updated, `${link.person.name} can't do it: ${note}`);
    return NextResponse.json({ request: todoView(updated) });
  }
  return bad("Unknown action.");
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
