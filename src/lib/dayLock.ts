// Day-close locking (D2, Phase 3): once a date is closed, its allocations
// stop moving. Call this at the top of any handler that edits a job or
// assignment for a specific date, before making the change.
import { NextResponse } from "next/server";
import { prisma } from "./prisma";

export async function assertDateOpen(date: string): Promise<NextResponse | null> {
  const close = await prisma.dayClose.findUnique({ where: { date } });
  if (close?.status === "CLOSED") {
    return NextResponse.json(
      { error: `${date} is closed. An Admin needs to re-open it (with a reason) before this can change.` },
      { status: 409 }
    );
  }
  return null;
}
