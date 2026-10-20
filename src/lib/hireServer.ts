// Server-side checks for the hire register fields (21 Oct 2026), run where a
// resource is created or changed - so a bad status, a project that doesn't
// exist or a negative charge is refused at the door, not found later.
import { prisma } from "./prisma";

const STATUSES = ["BOOKED", "ON_HIRE", "OFF_HIRE_REQUESTED", "RETURNED"];

export async function hireRegisterError(data: Record<string, unknown>): Promise<string | null> {
  if (data.hireStatus != null && !STATUSES.includes(String(data.hireStatus))) {
    return "Hire status must be Booked, On hire, Off-hire requested or Returned.";
  }
  for (const k of ["hireDeliveryCost", "hireCollectionCost"] as const) {
    const v = data[k];
    if (v != null && (typeof v !== "number" || Number.isNaN(v) || v < 0)) return "Delivery and pick-up charges must be $0 or more.";
  }
  if (typeof data.hireProjectId === "string") {
    const p = await prisma.project.findUnique({ where: { id: data.hireProjectId }, select: { id: true } });
    if (!p) return "That project doesn't exist any more - pick it again.";
  }
  return null;
}
