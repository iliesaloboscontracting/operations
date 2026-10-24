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

// PATCH /api/invoice-inbox/uploads/:id { action: "RETRY" } -> read a failed
// upload again (its earlier partial results are cleared first).
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardInvoiceInbox();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  if (body.action !== "RETRY") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const u = await prisma.invoiceUpload.findUnique({ where: { id: params.id } });
  if (!u) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (u.status !== "FAILED") return NextResponse.json({ error: "Only a failed upload can be read again." }, { status: 400 });
  await prisma.invoiceDraft.deleteMany({ where: { uploadId: u.id, status: { not: "ADDED" } } });
  await prisma.invoiceUpload.update({ where: { id: u.id }, data: { status: "READING", error: null, finishedAt: null } });
  processInBackground(u.id);
  return NextResponse.json({ ok: true });
});
