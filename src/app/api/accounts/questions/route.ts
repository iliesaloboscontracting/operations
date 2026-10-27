import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOwner } from "@/lib/owner";
import { accountsQuestions } from "@/lib/infoRequests/store";
import { isOperationsAi } from "@/lib/infoRequests/rules";

// GET /api/accounts/questions -> Accounts -> Questions (27 Oct 2026, docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md).
// The accounts login: every question asked of it, with history (answered via /api/queries/:id). The owner or an
// Admin with director access: every question to the accounts logins, read-only, plus who "Ask Victoria" can go to.
// Operations AI (the Building Agent login): only the questions it sent to accounts, and it may ask.
// Anyone else 403 - information requests never open for an Admin without director access. Answers change nothing.
export const GET = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const all = user.role === "ADMIN" && (isOwner(user.email) || user.directorAccess);
  const ai = !all && isOperationsAi(user.email, user.role);
  if (user.role !== "ACCOUNTS" && !all && !ai) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const canAsk = all || ai;
  const accounts = canAsk ? await prisma.user.findMany({ where: { role: "ACCOUNTS", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  return NextResponse.json({ questions: await accountsQuestions(user.id, all ? "ALL" : ai ? "AI" : "MINE"), canAsk, accounts });
});
