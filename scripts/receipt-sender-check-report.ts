// Who was on the truck - past receipts (Ilies, 10 Nov 2026). Read-only: it writes nothing and changes no receipt.
// Lists every tip docket / fuel receipt (not set aside) where the new check WOULD have fired: it names one of our
// trucks, people were signed in on that truck (truck QR) at the docket's time or when it was sent, and the link's
// owner wasn't one of them. The same rule the reading uses for new receipts (src/lib/receipts/senderStore.ts).
// For the office to review history - e.g. dockets sent on another driver's link.
//
// Usage (PowerShell), on a copy or - read-only - on the server:
//   $env:DATABASE_URL = "file:C:/path/to/prisma/test.db"
//   npx tsx scripts/receipt-sender-check-report.ts [--since 2026-11-02] [--csv]
// Without --since: every receipt.

import { prisma } from "../src/lib/prisma";
import { fromSydneyLocal } from "../src/lib/shiftTimes";
import { hasClockTime } from "../src/lib/receipts/checks";
import { logOf } from "../src/lib/receipts/runner";
import { senderCheck } from "../src/lib/receipts/senderStore";
import { truckRegos, vehicleForRego } from "../src/lib/receipts/tipStore";
import { csvCell } from "../src/lib/payroll/rules";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const when = (d: Date) => d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
// CSV cells go through the app's one formula-safe rule (SEC-012, PS-026): a typed name starting with = + - @ (or a
// tab / CR) is quoted and prefixed with ' so a spreadsheet never runs it as a formula.
const cell = csvCell;

async function main() {
  const since = arg("--since");
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since takes a date like 2026-11-02");
  const csv = process.argv.includes("--csv");
  const [trucks, rows] = await Promise.all([
    truckRegos(),
    prisma.receipt.findMany({
      where: { kind: { in: ["TIP", "FUEL"] }, status: { not: "REJECTED" }, ...(since ? { sentAt: { gte: fromSydneyLocal(`${since}T00:00`)! } } : {}) },
      select: { id: true, kind: true, status: true, sentBy: true, sentByResourceId: true, sentAt: true, docketAt: true, docketNo: true, rego: true, vehicleId: true, reading: true },
      orderBy: { sentAt: "asc" },
    }),
  ]);
  const regoOf = new Map(trucks.map((t) => [t.id, t.rego]));
  const hits: string[][] = [];
  for (const r of rows) {
    const vehicleId = r.kind === "TIP" ? vehicleForRego(r.rego, trucks) ?? r.vehicleId : r.vehicleId;
    // The docket's own time only when it printed one (or the office typed it in) - a date alone is no time.
    const log = logOf(r.reading);
    const result = (log.result ?? {}) as { dateTime?: string };
    const timed = hasClockTime(result.dateTime) || (log.corrections ?? []).some((c) => c.field === "docketAt");
    const hit = await senderCheck({ kind: r.kind, sentByResourceId: r.sentByResourceId, sentBy: r.sentBy, sentAt: r.sentAt, docketAt: timed ? r.docketAt : null, vehicleId });
    if (!hit) continue;
    hits.push([
      when(r.sentAt), r.kind === "TIP" ? "Tip docket" : "Fuel", (vehicleId && regoOf.get(vehicleId)) || r.rego || "", r.docketNo ?? "",
      r.sentBy, hit.onTruck.join(" + "), `${when(hit.at)} (${hit.what === "docket" ? "docket time" : "sent"})`, r.status, r.id,
    ]);
  }
  const head = ["Sent", "Kind", "Rego", "Docket no", "Link owner", "On the truck", "Checked at", "Status", "Receipt id"];
  if (csv) {
    console.log(head.map(cell).join(","));
    for (const h of hits) console.log(h.map(cell).join(","));
    return;
  }
  console.log(`Who was on the truck - past receipts${since ? ` since ${since}` : ""} (read-only)`);
  console.log(`${rows.length} tip dockets / fuel receipts looked at; ${hits.length} would be To check.\n`);
  for (const h of hits) console.log(h.join(" | "));
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
