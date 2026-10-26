import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { actOnRequest } from "@/lib/purchases/store";

// POST /api/site/:token/purchases/:id { action: ANSWER (answer) | CANCEL, version } - only on the link it was asked from.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id } = await params;
  const link = await resolveLink(token);
  if (!link || link.kind !== "OFFICE" || !link.person.id) return NextResponse.json({ error: "Not on this link." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  if (b.action !== "ANSWER" && b.action !== "CANCEL") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const out = await actOnRequest(id, b.action, { kind: "REQUESTER" }, { name: link.person.name, linkId: link.id }, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
