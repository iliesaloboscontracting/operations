// Victoria's OK / Query on a computed invoice flag (Accounts stage 4): hire invoices vs the register, and
// invoice lines over the agreed rate. Append-only (InvoiceFlagReview); the latest row per subject + flag counts.
import { prisma } from "@/lib/prisma";

export type FlagReview = { status: "OK" | "QUERY"; note: string | null; by: string; at: string };

export async function latestFlagReviews(subjectKind: "HIRE" | "RATE"): Promise<Map<string, FlagReview>> {
  const rows = await prisma.invoiceFlagReview.findMany({ where: { subjectKind }, orderBy: { at: "asc" } });
  return new Map(rows.map((r) => [`${r.subjectId}|${r.flag}`, { status: r.status as FlagReview["status"], note: r.note, by: r.by, at: r.at.toISOString() }]));
}

export async function reviewFlag(who: { id: string; name: string }, b: Record<string, unknown>): Promise<{ ok: true } | { error: string; status: number }> {
  const subjectKind = b.subjectKind === "HIRE" || b.subjectKind === "RATE" ? b.subjectKind : null;
  const subjectId = typeof b.subjectId === "string" ? b.subjectId.slice(0, 80) : "";
  const flag = typeof b.flag === "string" ? b.flag.slice(0, 40) : "";
  const status = b.status === "OK" || b.status === "QUERY" ? b.status : null;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  if (!subjectKind || !subjectId || !flag || !status) return { error: "Mark the flag OK or Query.", status: 400 };
  if (status === "QUERY" && (note?.length ?? 0) < 3) return { error: "Say what needs checking.", status: 400 };
  await prisma.invoiceFlagReview.create({ data: { subjectKind, subjectId, flag, status, note, by: who.name, byId: who.id } });
  return { ok: true };
}
