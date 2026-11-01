import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { createRequest, listForRequester, projectChoices } from "@/lib/purchases/store";
import { officePurchasesLink } from "@/lib/purchases/link";

// Purchase and hire requests from a personal OFFICE link (Alex, stage 6). Shared yard links and every other link kind
// get 404. Since 2 Nov 2026 (Ilies) these are the ONE link screens that may carry a dollar figure - the requester's
// own requests, their description and their suppliers' quotes and prices (lib/purchases/quotes.ts linkMayCarryMoney).
// Accounts' own amount and note never come here.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const link = await officePurchasesLink((await params).token);
  if (!link) return NextResponse.json({ error: "Not on this link." }, { status: 404 });
  const [requests, projects] = await Promise.all([listForRequester({ kind: "LINK", linkId: link.id, name: link.person.name }), projectChoices()]);
  return NextResponse.json({ person: link.person.name, requests, projects });
});

// POST - a new request, as in-app (quotes and their files included).
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const link = await officePurchasesLink((await params).token);
  if (!link) return NextResponse.json({ error: "Not on this link." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await createRequest({ kind: "LINK", linkId: link.id, name: link.person.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
