import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { readTicket } from "@/lib/signin";

// GET /api/site/in/search?ticket=&q= - for a crew member who isn't on the
// job's list (moved at short notice): names from the Personnel register
// matching what they type (3+ letters, at most 6). Needs a valid scan ticket.
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!readTicket(req.nextUrl.searchParams.get("ticket"))) return NextResponse.json({ error: "Scan the code again." }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 3) return NextResponse.json([]);
  const people = await prisma.resource.findMany({
    where: { type: "PERSONNEL", name: { contains: q } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 6,
  });
  return NextResponse.json(people);
});
