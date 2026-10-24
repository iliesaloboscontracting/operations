import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { pickContact } from "@/lib/pickContact";
import { CONTACT_TEXT_KEYS, moneyError, moneyProblems } from "@/lib/projectFile";

async function findContact(projectId: string, contactId: string) {
  return prisma.projectContact.findFirst({ where: { id: contactId, projectId }, select: { id: true } });
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
  const contact = await prisma.projectContact.update({ where: { id: params.contactId }, data });
  return NextResponse.json(contact);
});

// DELETE /api/projects/:id/contacts/:contactId - removes a contact entered
// by mistake or no longer on the job.
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string; contactId: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  if (!(await findContact(params.id, params.contactId))) {
    return NextResponse.json({ error: "That contact doesn't exist anymore." }, { status: 404 });
  }
  await prisma.projectContact.delete({ where: { id: params.contactId } });
  return NextResponse.json({ ok: true });
});
