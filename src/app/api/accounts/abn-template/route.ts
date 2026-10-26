import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { assertNoMoney } from "@/lib/moneyGuard";
import { csvCell } from "@/lib/payroll/rules";
import { templateFor } from "@/lib/abnInvoices/store";

// The standard Lobos ABN invoice (stage 4): a person's supervisor-approved hours for a period. Hours only -
// it goes to the worker, who copies it into their own invoice (ABN, rate, GST and total are theirs to fill).
// GET ?person&from&to[&format=csv]
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ?? "", to = q.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return NextResponse.json({ error: "Pick the period." }, { status: 400 });
  const t = await templateFor(q.get("person") ?? "", from, to);
  if (!t) return NextResponse.json({ error: "Pick the person." }, { status: 400 });
  if (!assertNoMoney(JSON.stringify(t))) throw new Error("money in an ABN template");
  if (q.get("format") !== "csv") return NextResponse.json(t);
  const rows = [["Lobos Contracting - hours for invoicing"], ["Name", t.name], ["Period", `${t.from} to ${t.to}`], [], ["Date", "Site", "Hours (supervisor approved)"], ...t.days.map((d) => [d.date, d.site, d.hours]), ["Total", "", t.total], [], ["Your ABN", ""], ["Invoice number", ""], ["Rate", ""], ["GST (if registered)", ""], ["Total", ""]];
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lobos-hours-${t.name.replace(/[^A-Za-z0-9]+/g, "-")}-${t.from}.csv"` } });
});
