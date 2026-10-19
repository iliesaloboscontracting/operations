import { NextResponse } from "next/server";
import { prisma } from "./prisma";

// A toolbox's supervisor must be someone in the Personnel register.
// Returns an error response, or null when it's fine (or not given).
export async function checkSupervisor(id: unknown): Promise<NextResponse | null> {
  if (!id) return null;
  if (typeof id !== "string") return NextResponse.json({ error: "Bad supervisor." }, { status: 400 });
  const r = await prisma.resource.findUnique({ where: { id }, select: { type: true } });
  if (r?.type !== "PERSONNEL") {
    return NextResponse.json({ error: "The supervisor must be someone in the Personnel register." }, { status: 400 });
  }
  return null;
}
