import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { normSite } from "@/lib/invoiceInbox";

// "Also called on invoices" (26 Oct 2026, Ilies): the other ways suppliers and
// accounts write this job's site ("Newcastle", "BARPA job"...). The invoices
// inbox uses them to match spreadsheet rows to the job (SiteAlias). Manager+.
// GET                -> { aliases: [{ text, createdBy, createdAt }] }
// POST { text }      -> add one; refused if that wording already means another job
// DELETE ?text=...   -> remove one (a matching hint only - no invoice or cost changes)
type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling(async (_req: NextRequest, { params }: Ctx) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const { id } = await params;
  const aliases = await prisma.siteAlias.findMany({ where: { projectId: id }, orderBy: { text: "asc" }, select: { text: true, createdBy: true, createdAt: true } });
  return NextResponse.json({ aliases });
});

export const POST = withErrorHandling(async (req: NextRequest, { params }: Ctx) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? normSite(body.text).slice(0, 120) : "";
  if (text.length < 3) return NextResponse.json({ error: "Type how invoices write this site (at least 3 letters)." }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "That project doesn't exist anymore." }, { status: 404 });
  const existing = await prisma.siteAlias.findUnique({ where: { text } });
  if (existing && existing.projectId !== id) {
    const other = await prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } });
    return NextResponse.json({ error: `"${text}" already means ${other?.name ?? "another job"} - remove it there first.` }, { status: 409 });
  }
  if (!existing) await prisma.siteAlias.create({ data: { text, projectId: id, createdBy: (await getCurrentUser())?.name ?? null } });
  return NextResponse.json({ text }, { status: 201 });
});

export const DELETE = withErrorHandling(async (req: NextRequest, { params }: Ctx) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const { id } = await params;
  const text = normSite(req.nextUrl.searchParams.get("text") ?? "");
  const out = await prisma.siteAlias.deleteMany({ where: { projectId: id, text } });
  if (!out.count) return NextResponse.json({ error: "That wording isn't on this job." }, { status: 404 });
  return NextResponse.json({ removed: text });
});
