import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardXeroUpload } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { decideMatch, reviewList } from "@/lib/xero/imports";

// GET  /api/xero/review -> sales invoices in the current upload not tied to a
// job yet (with any site-text suggestion), and the jobs to pick from.
// POST /api/xero/review {key, projectId | null, note} -> a person's decision,
// remembered for later uploads. ACCOUNTS + director access (G2).
export const GET = withErrorHandling(async () => {
  const g = await guardXeroUpload();
  if ("denied" in g) return g.denied;
  const [list, projects] = await Promise.all([
    reviewList(),
    prisma.project.findMany({ select: { id: true, name: true, jobNo: true, status: true, archived: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ ...list, projects });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardXeroUpload();
  if ("denied" in g) return g.denied;
  const r = await decideMatch(await req.json(), g.user);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
});
