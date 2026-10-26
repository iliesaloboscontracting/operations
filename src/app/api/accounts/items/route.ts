import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createItem, listItems } from "@/lib/accounts/store";

// The Accounts calendar (26 Oct 2026): due dates and reminders. Accounts login + Admins.
// GET  ?all=1 -> include done / cancelled
// POST { kind?, category, title, dueDate, repeat?, amount?, payee?, notes?, alertDays? }
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ items: await listItems({ all: req.nextUrl.searchParams.get("all") === "1" }) });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await createItem(g.user.name, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
