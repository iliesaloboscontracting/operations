import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { pickProject } from "@/lib/pickProject";
import { withErrorHandling } from "@/lib/apiHandler";
import { completeness } from "@/lib/projectFile";
import { currentSupervisor, validateProjectFile } from "@/lib/projectFileServer";

// GET /api/projects/:id -> the Project File: the project, its external
// contacts, its Lobos office contact and its current supervisor (read from
// the latest allocation). Viewer logins (crew) get the Site and Scope
// information and only contacts marked for crew - never the contract figures
// or the internal notes scratchpad.
export const GET = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      contacts: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      officeContact: { select: { id: true, name: true, phone: true, email: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "That project doesn't exist anymore." }, { status: 404 });
  }

  const { contacts, ...rest } = project;
  const out: Record<string, unknown> = {
    ...rest,
    contacts: isManager ? contacts : contacts.filter((c) => c.visibleTo === "CREW"),
    currentSupervisor: await currentSupervisor(project.id),
    completeness: completeness(rest, contacts.filter((c) => c.visibleTo === "CREW").length),
  };
  if (!isManager) {
    delete out.contractValue;
    delete out.contractValueNotes;
    delete out.notes;
  }
  return NextResponse.json(out);
});

export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  const data = pickProject(body);
  const invalid = await validateProjectFile(data);
  if (invalid) return invalid;
  const project = await prisma.project.update({
    where: { id: params.id },
    data: data as any,
  });
  return NextResponse.json(project);
});

// Deleting a project keeps its past jobs (projectId set null); prefer archiving.
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.project.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
