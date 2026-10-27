import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOwner } from "@/lib/owner";
import { accountsQuestions } from "@/lib/infoRequests/store";

// GET /api/accounts/questions -> Accounts -> Questions (27 Oct 2026, docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md).
// The accounts login: every question asked of it, with history (answered via /api/queries/:id). The owner or an
// Admin with director access: every question to the accounts logins, read-only, plus who "Ask Victoria" can go to.
// Anyone else 403 - information requests never open for an Admin without director access. Answers change nothing.
export const GET = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const all = user.role === "ADMIN" && (isOwner(user.email) || user.directorAccess);
  if (user.role !== "ACCOUNTS" && !all) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const accounts = all ? await prisma.user.findMany({ where: { role: "ACCOUNTS", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  return NextResponse.json({ questions: await accountsQuestions(user.id, all ? "ALL" : "MINE"), canAsk: all, accounts });
});
