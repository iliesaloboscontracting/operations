import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard, type AuthUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOperationsAi } from "@/lib/infoRequests/rules";
import { addSummary } from "@/lib/sheetEmails/rules";
import { addSheetEmails, removeSheetEmail, SheetEmailError, sheetEmailList } from "@/lib/sheetEmails/store";

// The allocation email list (Ilies, 20 Nov 2026) - the addresses the board's "Open in email" puts in To, every day.
// Managers and Admins only, on every method: the coordinator, Viewers, the yard, accounts, timesheets, director
// logins and site links get nothing. Workers' personal emails - never logged, never on a link.
//   GET  -> { active: [...], removed: [...], max }
//   POST { action: "add", text }        - a pasted block (one per line, or comma / semicolon separated)
//   POST { action: "remove", id, reason? } - soft remove (the row is kept forever; add it again to put it back)
// SE-002 (Ilies, 23 Nov 2026): the Building Agent login (Operations AI) is a Manager but never reads or changes the list.
async function allowed(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const denied = await guard("MANAGER");
  if (denied) return { denied };
  const user = await getCurrentUser();
  if (!user || isOperationsAi(user.email, user.role))
    return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  return { user };
}

export const GET = withErrorHandling(async () => {
  const a = await allowed();
  if ("denied" in a) return a.denied;
  return NextResponse.json(await sheetEmailList(), { headers: { "Cache-Control": "no-store" } });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const a = await allowed();
  if ("denied" in a) return a.denied;
  const user = a.user;
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "add") {
      const r = await addSheetEmails(body.text, user);
      return NextResponse.json({ ok: true, ...r, message: addSummary(r) });
    }
    if (body?.action === "remove") {
      const r = await removeSheetEmail(body.id, body.reason, user);
      return NextResponse.json({ ok: true, id: r.id });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    if (e instanceof SheetEmailError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
