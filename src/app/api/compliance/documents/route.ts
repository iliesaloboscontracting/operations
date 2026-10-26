import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createDocument, holderSuggestions, listDocuments } from "@/lib/compliance/store";

// Company and subcontractor documents with expiries. Accounts + Admins.
// GET  ?all=1 -> include archived
// POST { holderType, holderName, kind, title, reference?, issueDate?, expiryDate?, notes? }
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const [documents, holders] = await Promise.all([listDocuments({ all: req.nextUrl.searchParams.get("all") === "1" }), holderSuggestions()]);
  return NextResponse.json({ documents, holders });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const out = await createDocument(g.user.name, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
