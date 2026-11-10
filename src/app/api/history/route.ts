import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { HISTORY_MODELS, isHistoryModel } from "@/lib/history/diff";
import { canReadHistory, visibleChanges } from "@/lib/history/access";
import { historyOf } from "@/lib/history/store";

// GET /api/history?model=Resource&id=... -> that record's change history, newest first (keep forever, Ilies
// 10 Nov 2026). The same walls as the record itself (lib/history/access.ts): a field the caller can't see on the record
// (pay rates, day / hire rates, contract figures) is left out of its history too. Read-only; nothing here changes.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // A login that may read no history at all (crew, timesheets, directors, the coordinator, the yard) is refused first.
  if (!HISTORY_MODELS.some((m) => canReadHistory(m, user.role))) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const model = req.nextUrl.searchParams.get("model");
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!isHistoryModel(model) || !id || id.length > 64) return NextResponse.json({ error: "Unknown record" }, { status: 400 });
  if (!canReadHistory(model, user.role)) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const rows = visibleChanges(model, user.role, await historyOf(model, id));
  return NextResponse.json({
    changes: rows.map((r) => ({ id: r.id, field: r.field, before: r.before, after: r.after, by: r.changedBy, at: r.changedAt.toISOString(), source: r.source, reason: r.reason })),
  });
});
