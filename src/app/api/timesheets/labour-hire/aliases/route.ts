import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addCompany, AliasError, mapCompany, retireCompany, retireCompanyAlias } from "@/lib/labourHire/store";

// POST /api/timesheets/labour-hire/aliases (11 Nov 2026) - the labour hire timesheet's company names, Managers and
// Admins only (the coordinator only views them on the page):
//   { action: "map", typed: "ALH", company: "Advanced Labour Hire" } - this typed name means that company;
//   { action: "retire", id, reason } - stop using a mapping;
//   { action: "list-add", name } - put a company on the sign-in list (13 Nov 2026), or back on;
//   { action: "list-retire", id, reason } - take a company off the sign-in list.
// Keep forever: a mapping is never deleted (there is no DELETE); every change is in its history (RecordChange).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "map") {
      const { row, changed } = await mapCompany(body.typed, body.company, user);
      return NextResponse.json({ ok: true, id: row.id, changed });
    }
    if (body?.action === "retire") {
      const row = await retireCompanyAlias(body.id, body.reason, user);
      return NextResponse.json({ ok: true, id: row.id });
    }
    if (body?.action === "list-add") {
      const { row } = await addCompany(body.name, user);
      return NextResponse.json({ ok: true, id: row.id });
    }
    if (body?.action === "list-retire") {
      const row = await retireCompany(body.id, body.reason, user);
      return NextResponse.json({ ok: true, id: row.id });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    if (e instanceof AliasError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
