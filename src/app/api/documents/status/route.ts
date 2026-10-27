import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { guardDocuments } from "@/lib/docsearch/guard";
import { status } from "@/lib/docsearch/index";
import { pickSource } from "@/lib/docsearch/service";

// GET /api/documents/status -> whether search is connected, the last refresh, how many documents this login's levels
// cover and how many weren't readable. The not-readable list (name, folder, why) is for Admins.
export const GET = withErrorHandling(async () => {
  const g = await guardDocuments();
  if ("denied" in g) return g.denied;
  const p = pickSource();
  const s = status(g.levels);
  return NextResponse.json({
    connected: !("off" in p), why: "off" in p ? p.off : null, source: "off" in p ? null : p.source.name,
    documents: s.documents, notReadable: s.notReadable, lastRun: s.lastRun,
    unreadable: g.user.role === "ADMIN" ? s.unreadable : undefined, canRefresh: g.user.role === "ADMIN",
  });
});
