import { NextResponse } from "next/server";
import { guardIncidents } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { incidentList } from "@/lib/siteDocs/incidents";

// GET /api/directors/incidents -> every incident report, newest first, with its follow-up status. The owner and DIRECTOR
// logins ONLY (guardIncidents) - never a Manager, another Admin (even with the director tick), the coordinator,
// accounts, the yard or the Building Agent. Health details never go to any AI.
export const GET = withErrorHandling(async () => {
  const g = await guardIncidents();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await incidentList());
});