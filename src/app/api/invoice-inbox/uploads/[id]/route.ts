import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardInvoiceInbox } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { invoiceMimeOf, readInvoiceFile } from "@/lib/invoiceFiles";
import { processInBackground } from "@/lib/invoiceInbox";

// GET /api/invoice-inbox/uploads/:id -> the uploaded file itself (to check
// an invoice against what was read).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardInvoiceInbox();
  if ("denied" in g) return g.denied;
  const u = await prisma.invoiceUpload.findUnique({ where: { id: params.id } });
  if (!u) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readInvoiceFile(u.fileName);
  const mime = invoiceMimeOf(u.fileName);
  const inline = mime === "application/pdf" || mime.startsWith("image/");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${u.originalName.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// PATCH /api/invoice-inbox/uploads/:id
//   { action: "RETRY" }   -> read a failed upload again (its earlier partial results are cleared first)
//   { action: "CLEAR" }   -> take a finished upload off the Invoices tab (Ilies, 26 Oct 2026). Lines still
//                            waiting are put on hold (kept, with why); nothing is deleted and nothing on a
//                            job changes. "Show cleared" lists them again.
//   { action: "UNCLEAR" } -> put it back on the tab
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardInvoiceInbox();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const u = await prisma.invoiceUpload.findUnique({ where: { id: params.id } });
  if (!u) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (body.action === "CLEAR") {
    if (u.status === "READING") return NextResponse.json({ error: "It's still being read - wait for it to finish." }, { status: 400 });
    const open = await prisma.invoiceDraft.findMany({ where: { uploadId: u.id, status: { in: ["NEEDS_REVIEW", "NO_JOB"] } }, select: { id: true, problem: true } });
    await prisma.$transaction([
      ...open.map((d) => prisma.invoiceDraft.update({
        where: { id: d.id },
        data: { status: "SKIPPED", problem: `On hold - cleared from the inbox by ${g.user.name}: ${d.problem ?? "not decided"}`.slice(0, 300), decidedBy: g.user.name, decidedAt: new Date() },
      })),
      prisma.invoiceUpload.update({ where: { id: u.id }, data: { clearedAt: new Date(), clearedBy: g.user.name } }),
    ]);
    return NextResponse.json({ ok: true, onHold: open.length });
  }
  if (body.action === "UNCLEAR") {
    await prisma.invoiceUpload.update({ where: { id: u.id }, data: { clearedAt: null, clearedBy: null } });
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "RETRY") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (u.status !== "FAILED") return NextResponse.json({ error: "Only a failed upload can be read again." }, { status: 400 });
  await prisma.invoiceDraft.deleteMany({ where: { uploadId: u.id, status: { not: "ADDED" } } });
  await prisma.invoiceUpload.update({ where: { id: u.id }, data: { status: "READING", error: null, finishedAt: null } });
  processInBackground(u.id);
  return NextResponse.json({ ok: true });
});
