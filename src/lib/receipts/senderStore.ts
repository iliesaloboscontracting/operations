// Who was on the truck (Ilies, 10 Nov 2026: "when a docket or fuel receipt names a truck, check who was signed
// in on that truck at the time; if it isn't the link's owner, mark it To check with a note"). The facts come from
// the truck QR sign-ins (SiteAttendance place VEHICLE); the rule is decideSender in ./checks.ts. Read-only here:
// the reading runner (./runner.ts) adds the note to a new reading; scripts/receipt-sender-check-report.ts lists
// past receipts where it would have fired. The note is office-side only (/receipts) - never on a link.
import { prisma } from "../prisma";
import { sydneyTime } from "../signin";
import { decideSender, normRego, ON_TRUCK_MAX_HOURS, senderMoments, type SenderFinding } from "./checks";

export type SenderFacts = {
  kind: string; sentByResourceId: string | null; sentBy: string; sentAt: Date;
  docketAt: Date | null; // only when the docket printed a time (a date alone is no time to check)
  vehicleId: string | null; // the truck the receipt names: a TIP's read rego, a FUEL's picked truck
};

type Db = Pick<typeof prisma, "siteAttendance" | "resource">;

// The truck's rego as the office knows it ("Tipper - XO20TL" -> XO20TL), else its name.
async function truckLabel(vehicleId: string, db: Db): Promise<string> {
  const t = await db.resource.findUnique({ where: { id: vehicleId }, select: { name: true, identifier: true } });
  if (!t) return "the truck";
  const rego = normRego(t.identifier || t.name.split(" - ").pop());
  return rego.length >= 4 ? rego : t.name;
}

// `db` is the app database; a unit test passes a stand-in.
export async function senderCheck(r: SenderFacts, db: Db = prisma): Promise<SenderFinding | null> {
  if ((r.kind !== "TIP" && r.kind !== "FUEL") || !r.vehicleId || !r.sentByResourceId) return null;
  const moments = senderMoments(r.sentAt, r.docketAt);
  const first = Math.min(...moments.map((m) => m.at.getTime())), last = Math.max(...moments.map((m) => m.at.getTime()));
  const signIns = await db.siteAttendance.findMany({
    where: {
      place: "VEHICLE", vehicleId: r.vehicleId, status: { not: "REJECTED" }, removedAt: null,
      signInAt: { lte: new Date(last), gte: new Date(first - ON_TRUCK_MAX_HOURS * 3_600_000) },
    },
    select: { resourceId: true, workerName: true, signInAt: true, signOutAt: true },
    orderBy: { signInAt: "asc" },
  });
  if (!signIns.length) return null;
  return decideSender({
    ownerId: r.sentByResourceId, ownerName: r.sentBy, truck: await truckLabel(r.vehicleId, db), moments, signIns,
    time: (d) => sydneyTime(d) ?? "",
  });
}
