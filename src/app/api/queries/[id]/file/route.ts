import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { invoiceMimeOf, readInvoiceFile } from "@/lib/invoiceFiles";
import { canSeeAnswerFile } from "@/lib/findings/queries";

// GET /api/queries/:id/file -> the file sent with a query's answer: the
// person who answered, Ilies, directors and Admins (the Requests page).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id }, select: { kind: true, answerFile: true, assigneeUserId: true } });
  if (!r || r.kind !== "QUERY" || !r.answerFile || !canSeeAnswerFile(r, user)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bytes = await readInvoiceFile(r.answerFile).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": invoiceMimeOf(r.answerFile), "Cache-Control": "private, max-age=3600" } });
});
