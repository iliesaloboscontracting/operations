import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { guardDocuments } from "@/lib/docsearch/guard";
import { searchOrClosed } from "@/lib/docsearch/service";

// GET /api/documents?q=words -> matching documents this login may see (LCI phase 6, docs/lci/PHASE6-DESIGN.md).
// Managers and Admins only; the level filter runs in SQL. Each hit: name, snippet, folder, path, date, revision and
// the SharePoint link (Microsoft re-checks the user's own permission when it's opened).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardDocuments();
  if ("denied" in g) return g.denied;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  // DS-016: no source for any reason -> no hits, with the reason; each hit re-checked against today's folder rules.
  return NextResponse.json(searchOrClosed(q, g.levels));
});
