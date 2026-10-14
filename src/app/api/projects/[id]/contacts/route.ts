import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { pickContact } from "@/lib/pickContact";
import { CONTACT_TEXT_KEYS, moneyError, moneyProblems } from "@/lib/projectFile";

// POST /api/projects/:id/contacts { name, company, role, phone, email, visibleTo, source }
// Adds an external contact (client, builder, consultant) to a project. Lobos
// staff aren't added here - they come from the Personnel register.
export const POST = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const data = pickContact(await req.json());
  if (!data.name) return NextResponse.json({ error: "A contact needs a name." }, { status: 400 });
  const problems = moneyProblems(data, CONTACT_TEXT_KEYS);
  if (problems.length) return NextResponse.json({ error: moneyError(problems) }, { status: 422 });

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "That project doesn't exist anymore." }, { status: 404 });

  const contact = await prisma.projectContact.create({
    data: { ...(data as { name: string }), projectId: params.id },
  });
  return NextResponse.json(contact, { status: 201 });
});
