import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createRequest, listForRequester, listOthers, projectChoices } from "@/lib/purchases/store";
import { SEES_ALL_REQUESTS } from "@/lib/purchases/quotes";
import { purchaseBody } from "@/lib/purchases/serve";

// In-app purchase and hire requests (stage 6): Managers, Admins and the coordinator (Alex, 2 Nov 2026) ask - DIRECTOR
// and ACCOUNTS logins never reach Operations, so they're refused here too (the lead, 27 Oct 2026). Each sees their own
// requests, with their suppliers' quotes and prices (Ilies, 2 Nov 2026), and everyone else's read-only ("ALL
// requests, read-only"). Accounts' own amount and note are never here. Nobody approves from here (lib/purchases/rules.ts).
async function asker(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!SEES_ALL_REQUESTS.includes(user.role)) return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  return { user };
}

export const GET = withErrorHandling(async () => {
  const a = await asker();
  if ("denied" in a) return a.denied;
  const [requests, others, projects] = await Promise.all([
    listForRequester({ kind: "APP", userId: a.user.id, name: a.user.name }), listOthers(a.user.id), projectChoices(),
  ]);
  return NextResponse.json({ requests, others, projects });
});

// POST { kind?, what, why?, qty?, linkUrl?, neededBy?, projectId?, quotes?: [{ supplier, priceExGst?, details?, linkUrl?, file?: { dataUrl, name } }] }
export const POST = withErrorHandling(async (req: NextRequest) => {
  const a = await asker();
  if ("denied" in a) return a.denied;
  const read = await purchaseBody(req); // 413 "Too large" when the body can't be read (7 MB option A)
  if ("denied" in read) return read.denied;
  const out = await createRequest({ kind: "APP", userId: a.user.id, name: a.user.name }, read.b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
