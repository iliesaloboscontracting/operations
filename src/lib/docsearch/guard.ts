// LCI phase 6: who may use document search - Manager and Admin logins (D6-1). Viewers, Timesheets, DIRECTOR and
// ACCOUNTS logins are refused; no site link reaches it (links never carry a login).
import { NextResponse } from "next/server";
import { getCurrentUser, type AuthUser } from "../auth";
import { canSearch, levelsFor, type Level } from "./folders";

export async function guardDocuments(): Promise<{ denied: NextResponse } | { user: AuthUser; levels: Level[] }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!canSearch(user)) return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  return { user, levels: levelsFor(user) };
}
