import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { todaySydney } from "@/lib/today";
import { approveDay, dayHoursForLink } from "@/lib/payroll/store";

// The supervisor approves a day's hours for their crew (Accounts stage 2) - a separate step after
// sign-out; the sign-in flow itself doesn't change. Supervisor links only. Names and hours only.
// GET  ?date=YYYY-MM-DD (default today) -> their jobs that day with each person's in / out / hours
// POST { jobId, date, flags?: { [attendanceId]: note }, note? } -> approve that job's day
const dead = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });

export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveLink((await paramsP).token);
  if (!link) return dead();
  if (link.kind !== "SUPERVISOR") return NextResponse.json({ error: "Hours are approved from a supervisor's own link." }, { status: 403 });
  const q = req.nextUrl.searchParams.get("date");
  const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todaySydney();
  return NextResponse.json(await dayHoursForLink(link, date));
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveLink((await paramsP).token);
  if (!link) return dead();
  const body = await req.json().catch(() => ({}));
  const out = await approveDay(link, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
