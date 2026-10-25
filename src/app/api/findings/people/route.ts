import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOwner } from "@/lib/owner";
import { canActOnFindings } from "@/lib/findings/actions";

// GET /api/findings/people -> who a finding can be given to (owners: the
// people who act on findings) and who a query can go to (the accounts login,
// directors, and register people with an active site link). Names only.
export const GET = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Task J: Admins and Managers act on operations-screen findings too.
  const opsActor = user.role === "ADMIN" || user.role === "MANAGER";
  if (!canActOnFindings(user) && !opsActor) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const [users, linked] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true, directorAccess: true }, orderBy: { name: "asc" } }),
    prisma.resource.findMany({
      where: { type: "PERSONNEL", active: true, siteLinks: { some: { revokedAt: null, kind: { in: ["SUPERVISOR", "OFFICE"] } } } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({
    owners: users.filter((u) => canActOnFindings(u)).map((u) => ({ id: u.id, name: u.name })),
    // Who can own an operations-screen finding (Attention): the owner, Admins, Managers.
    opsOwners: users.filter((u) => isOwner(u.email) || u.role === "ADMIN" || u.role === "MANAGER").map((u) => ({ id: u.id, name: u.name })),
    askUsers: users
      .filter((u) => !isOwner(u.email) && u.id !== user.id && (u.role === "ACCOUNTS" || u.role === "DIRECTOR" || u.directorAccess))
      .map((u) => ({ id: u.id, name: u.name, kind: u.role === "ACCOUNTS" ? "Accounts" : "Director" })),
    askLinks: linked.map((r) => ({ id: r.id, name: r.name, role: r.role })),
  });
});
