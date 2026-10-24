import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardInvoiceInbox } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { saveInvoiceFile } from "@/lib/invoiceFiles";
import { processInBackground } from "@/lib/invoiceInbox";

// GET /api/invoice-inbox -> uploads, invoices found in them, and the job /
// hire-item lists for matching. Accounts (ACCOUNTS role), Managers, Admins.
// Shows invoice amounts only - no pay rates, no other job costs.
export const GET = withErrorHandling(async () => {
  const g = await guardInvoiceInbox();
  if ("denied" in g) return g.denied;

  // A read that never finished (server restarted mid-way) is shown as failed.
  await prisma.invoiceUpload.updateMany({
    where: { status: "READING", createdAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: "FAILED", error: "Reading stopped part-way - try again.", finishedAt: new Date() },
  });

  const [uploads, drafts, projects, hireItems] = await Promise.all([
    prisma.invoiceUpload.findMany({
      orderBy: { createdAt: "desc" }, take: 40,
      select: { id: true, originalName: true, kind: true, status: true, error: true, uploadedBy: true, createdAt: true, finishedAt: true },
    }),
    prisma.invoiceDraft.findMany({
      where: { OR: [{ status: { in: ["NEEDS_REVIEW", "NO_JOB"] } }, { updatedAt: { gt: new Date(Date.now() - 60 * 86_400_000) } }] },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 600,
    }),
    prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } }),
    prisma.resource.findMany({
      where: { type: "HIRE", hireProjectId: { not: null }, NOT: { category: "LABOUR" } },
      select: { id: true, name: true, agency: true, hireRef: true, hireProjectId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // An invoice taken off a job in Tracking is no longer "added".
  const addedIds = drafts.filter((d) => d.status === "ADDED" && d.invoicedCostId).map((d) => d.invoicedCostId as string);
  const live = new Set((await prisma.invoicedCost.findMany({ where: { id: { in: addedIds } }, select: { id: true } })).map((r) => r.id));
  for (const d of drafts) if (d.status === "ADDED" && d.invoicedCostId && !live.has(d.invoicedCostId)) {
    d.status = "NEEDS_REVIEW"; d.problem = "Removed from the job in Tracking - decide again."; d.invoicedCostId = null;
  }

  const counts = new Map<string, Record<string, number>>();
  for (const d of await prisma.invoiceDraft.groupBy({ by: ["uploadId", "status"], _count: true })) {
    const c = counts.get(d.uploadId) ?? {};
    c[d.status] = d._count;
    counts.set(d.uploadId, c);
  }

  return NextResponse.json({
    uploads: uploads.map((u) => ({ ...u, counts: counts.get(u.id) ?? {} })),
    drafts,
    projects,
    hireItems,
  });
});

// POST /api/invoice-inbox { dataUrl, name } -> the new upload. Reading
// happens in the background; the page checks back for the result.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardInvoiceInbox();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const saved = await saveInvoiceFile(body.dataUrl, body.name);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
  const upload = await prisma.invoiceUpload.create({
    data: { fileName: saved.fileName, originalName: String(body.name).slice(0, 200), kind: saved.kind, uploadedBy: g.user.name },
  });
  processInBackground(upload.id);
  return NextResponse.json({ id: upload.id }, { status: 201 });
});
