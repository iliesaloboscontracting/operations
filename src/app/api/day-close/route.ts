import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { dayFingerprint, planDayCosts, supersedeDayCosts, writeDayCosts } from "@/lib/dayClose";
import { recordChanges, writeLock } from "@/lib/history/store";

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
      await writeLock(tx);
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

  // PS-030 (Ilies approved, 10 Nov 2026): the costs are worked out first, read-only, outside any transaction. The short
  // transaction takes the write lock, checks the day still reads the same, then closes, supersedes the earlier ledger
  // (kept) and writes the new one with the day's history. If the day changed meanwhile it is worked out once more;
  // changed again -> 409, nothing written.
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await planDayCosts(date);
    const close = await prisma.$transaction(async (tx) => {
      await writeLock(tx);
      if ((await dayFingerprint(tx, date)) !== plan.fingerprint) return null;
      const before = await tx.dayClose.findUnique({ where: { date } });
      const row = await tx.dayClose.upsert({
        where: { date },
        create: { date, status: "CLOSED", closedBy: user!.name, closedAt: new Date() },
        update: { status: "CLOSED", closedBy: user!.name, closedAt: new Date() },
      });
      await recordChanges(tx, "DayClose", row.id, before, row, { by: user, source: "Close day" }, ["status", "closedBy", "closedAt"]);
      await writeDayCosts(tx, date, plan.rows, `Closed again by ${user!.name}`);
      return row;
    });
    if (close) return NextResponse.json(close);
  }
  return NextResponse.json({ error: "The day changed while closing - try again." }, { status: 409 });
});
