import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { freezeDayCosts, supersedeDayCosts } from "@/lib/dayClose";
import { recordChanges } from "@/lib/history/store";

// GET /api/day-close?date=YYYY-MM-DD -> that date's close status (OPEN if no row)
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 });

  const close = await prisma.dayClose.findUnique({ where: { date } });
  return NextResponse.json(
    close ?? { date, status: "OPEN", closedBy: null, closedAt: null, reopenedBy: null, reopenedAt: null, reopenReason: null }
  );
});

// POST /api/day-close { date, action: "close" | "reopen", reason? }
// Close: Manager+. Re-open: Admin only, with a reason (D2, 2026-09-28).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();
  const { date, action } = body;
  if (!date || (action !== "close" && action !== "reopen")) {
    return NextResponse.json({ error: "date and a valid action are required" }, { status: 400 });
  }

  if (action === "reopen") {
    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Only an Admin can re-open a closed day" }, { status: 403 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "A reason is required to re-open a closed day" }, { status: 400 });

    // Keep forever (10 Nov 2026): the close it replaces is kept in the day's history (RecordChange), and the frozen
    // ledger is marked superseded (kept, never deleted) so the date goes back to live costing - one transaction.
    const close = await prisma.$transaction(async (tx) => {
      const before = await tx.dayClose.findUnique({ where: { date } });
      const row = await tx.dayClose.upsert({
        where: { date },
        create: { date, status: "OPEN", reopenedBy: user.name, reopenedAt: new Date(), reopenReason: reason },
        update: { status: "OPEN", reopenedBy: user.name, reopenedAt: new Date(), reopenReason: reason },
      });
      await recordChanges(tx, "DayClose", row.id, before, row, { by: user, source: "Re-open day", reason }, ["status", "reopenedBy", "reopenedAt", "reopenReason"]);
      await supersedeDayCosts(tx, date, `Re-opened by ${user.name}`);
      return row;
    });
    return NextResponse.json(close);
  }

  // The close, its history and the fresh ledger (earlier rows superseded, kept) in one transaction.
  const close = await prisma.$transaction(async (tx) => {
    const before = await tx.dayClose.findUnique({ where: { date } });
    const row = await tx.dayClose.upsert({
      where: { date },
      create: { date, status: "CLOSED", closedBy: user!.name, closedAt: new Date() },
      update: { status: "CLOSED", closedBy: user!.name, closedAt: new Date() },
    });
    await recordChanges(tx, "DayClose", row.id, before, row, { by: user, source: "Close day" }, ["status", "closedBy", "closedAt"]);
    await freezeDayCosts(date, `Closed again by ${user!.name}`, tx);
    return row;
  }, { timeout: 30_000 });
  return NextResponse.json(close);
});
