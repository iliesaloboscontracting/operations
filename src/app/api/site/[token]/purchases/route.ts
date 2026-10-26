import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { createRequest, listForRequester, projectChoices } from "@/lib/purchases/store";

// Purchase requests from a personal OFFICE link (Alex, stage 6). Never an amount: the list is the narrow
// requester view, and text with a dollar figure is refused. Shared yard links and supervisors' links get 404.
async function officeLink(token: string) {
  const link = await resolveLink(token);
  return link && link.kind === "OFFICE" && link.person.id ? link : null;
}

export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const link = await officeLink((await params).token);
  if (!link) return NextResponse.json({ error: "Not on this link." }, { status: 404 });
  const [requests, projects] = await Promise.all([listForRequester({ kind: "LINK", linkId: link.id, name: link.person.name }), projectChoices()]);
  return NextResponse.json({ person: link.person.name, requests, projects });
});

export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const link = await officeLink((await params).token);
  if (!link) return NextResponse.json({ error: "Not on this link." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await createRequest({ kind: "LINK", linkId: link.id, name: link.person.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
