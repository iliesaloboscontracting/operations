import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { rankAtLeast } from "@/lib/roleRank";
import { pickServiceRecord } from "@/lib/pickServiceRecord";
import { withErrorHandling } from "@/lib/apiHandler";
import { serviceRow } from "@/lib/prestart/history";

// Service history lives on vehicles, plant and attachments only (PS-060, 12 Nov 2026).
const SERVICE_TYPES = ["VEHICLE", "EQUIPMENT", "ATTACHMENT"];
async function asset(id: string) {
  const r = await prisma.resource.findUnique({ where: { id }, select: { id: true, type: true } });
  return r && SERVICE_TYPES.includes(r.type) ? r : null;
}

// GET /api/resources/:id/service -> that resource's service history, newest first
// Managers and Admins: the full records, as before (stage 6 D5 - amounts stay for Managers until Ilies decides).
// PS-060 (Ilies approved 12 Nov 2026): below Manager, a narrow record built field by field - date, provider, work,
// odometer / hours - with no amount, GST, total, invoice number, notes or who entered it; the words cleaned as on the
// plant QR (publicWords; an invoice-inbox record reads "Service (mechanic's invoice)").
export const GET = withErrorHandling(async (
  _req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("VIEWER");
  if (denied) return denied;
  if (!(await asset(params.id))) return NextResponse.json({ error: "That isn't a vehicle or plant item." }, { status: 404 });
  const user = await getCurrentUser();
  const where = { resourceId: params.id, removedAt: null }; // a removed record is kept, never shown (10 Nov 2026)
  if (user && rankAtLeast(user.role, "MANAGER")) {
    return NextResponse.json(await prisma.serviceRecord.findMany({ where, orderBy: { date: "desc" } }));
  }
  const rows = await prisma.serviceRecord.findMany({
    where, orderBy: { date: "desc" },
    select: { id: true, resourceId: true, date: true, mechanic: true, work: true, odometer: true, invoiceDraftId: true },
  });
  return NextResponse.json(rows.map((r) => {
    const s = serviceRow(r);
    return { id: r.id, resourceId: r.resourceId, date: s.date, mechanic: s.provider, work: s.work, odometer: s.reading };
  }));
});

// POST /api/resources/:id/service -> add a service record
export const POST = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  if (!(await asset(params.id))) return NextResponse.json({ error: "That isn't a vehicle or plant item." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (!body.date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }
  const record = await prisma.serviceRecord.create({
    data: { resourceId: params.id, ...pickServiceRecord(body) } as any,
  });
  return NextResponse.json(record, { status: 201 });
});
