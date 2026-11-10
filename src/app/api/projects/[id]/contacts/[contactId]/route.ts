import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { hideTracked, updateTracked } from "@/lib/history/store";
import { withErrorHandling } from "@/lib/apiHandler";
import { pickContact } from "@/lib/pickContact";
import { CONTACT_TEXT_KEYS, moneyError, moneyProblems } from "@/lib/projectFile";

async function findContact(projectId: string, contactId: string) {
  return prisma.projectContact.findFirst({ where: { id: contactId, projectId, removedAt: null }, select: { id: true } });
}

// PATCH /api/projects/:id/contacts/:contactId
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string; contactId: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const data = pickContact(await req.json());
  if ("name" in data && !data.name) return NextResponse.json({ error: "A contact needs a name." }, { status: 400 });
  const problems = moneyProblems(data, CONTACT_TEXT_KEYS);
  if (problems.length) return NextResponse.json({ error: moneyError(problems) }, { status: 422 });
  if (!(await findContact(params.id, params.contactId))) {
    return NextResponse.json({ error: "That contact doesn't exist anymore." }, { status: 404 });
  }
  // Every field that changed is kept in the contact's history (keep forever, 10 Nov 2026).
  const contact = await updateTracked("ProjectContact", params.contactId, data as Record<string, unknown>, { by: await getCurrentUser(), source: "Project contact edit" });
  return NextResponse.json(contact);
});

// DELETE /api/projects/:id/contacts/:contactId { reason? } - removes a contact entered by mistake or no longer on the
// job. Keep forever (Ilies, 10 Nov 2026): hidden (removedAt / By / Reason), never erased.
export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string; contactId: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  if (!(await findContact(params.id, params.contactId))) {
    return NextResponse.json({ error: "That contact doesn't exist anymore." }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  await hideTracked("ProjectContact", params.contactId, { by: await getCurrentUser(), reason: typeof body?.reason === "string" ? body.reason : null, source: "Project contact (remove)" });
  return NextResponse.json({ ok: true });
});
