import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { quoteFile } from "@/lib/purchases/store";
import { maySeeQuoteFile } from "@/lib/purchases/quotes";
import { quoteFileReply } from "@/lib/purchases/serve";

// GET /api/purchases/quotes/:quoteId/file -> a supplier's quote file (2 Nov 2026), shown in the browser, not cached.
// For whoever sees the request: every Manager / Admin / the coordinator (/purchases), accounts, director access, and
// the person who asked. Never a public path; the OFFICE link has its own route (/api/site/:token/purchases/quotes/...).
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = await quoteFile((await params).quoteId);
  if (!q || !maySeeQuoteFile(user, q.request)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return quoteFileReply(q);
});
