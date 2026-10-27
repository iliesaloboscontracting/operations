import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { guardDocuments } from "@/lib/docsearch/guard";
import { refreshNow } from "@/lib/docsearch/service";

// POST /api/documents/refresh -> an Admin's "Refresh now" (D6-4): reads changed files in the approved folders, at most
// every 15 minutes. Off / not connected -> a plain answer, no call out.
export const POST = withErrorHandling(async () => {
  const g = await guardDocuments();
  if ("denied" in g) return g.denied;
  if (g.user.role !== "ADMIN") return NextResponse.json({ error: "Only an Admin can refresh the index." }, { status: 403 });
  const r = await refreshNow();
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.result);
});
