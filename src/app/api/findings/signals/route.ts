import { NextResponse } from "next/server";
import { guard, getCurrentUser, hasDirectorAccess } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadSignals } from "@/lib/findings/load";
import { countByKind } from "@/lib/findings/signals";

// GET /api/findings/signals -> today's computed signals, for checking the
// findings layer before anything is stored (Phase 2 step 1, 24 Oct 2026).
// Manager+ and read-only. Audience is applied here too: DIRECTOR signals only
// for director access (none exist yet).
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const { today, asAt, signals } = await loadSignals();
  const visible = signals.filter((s) => s.audience !== "DIRECTOR" || hasDirectorAccess(user));
  return NextResponse.json({ today, asAt, counts: countByKind(visible), signals: visible });
});
