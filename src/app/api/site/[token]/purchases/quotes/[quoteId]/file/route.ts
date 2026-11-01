import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { quoteFile } from "@/lib/purchases/store";
import { officePurchasesLink } from "@/lib/purchases/link";
import { quoteFileReply } from "@/lib/purchases/serve";

// GET /api/site/:token/purchases/quotes/:quoteId/file -> a quote file on a request asked from THIS OFFICE link
// (2 Nov 2026). Any other link, or a request asked from somewhere else, gets 404.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ token: string; quoteId: string }> }) => {
  const { token, quoteId } = await params;
  const link = await officePurchasesLink(token);
  if (!link) return NextResponse.json({ error: "Not on this link." }, { status: 404 });
  const q = await quoteFile(quoteId);
  if (!q || q.request.siteLinkId !== link.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  return quoteFileReply(q);
});
