"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/tracking/parts";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import ChangeCard from "./ChangeCard";
import type { ChangeDTO } from "@/lib/changes/store";

// "Changes to approve" on the Directors overview (LCI phase 4, step 4f): the
// COMMERCIAL proposals only - contract values, which Nick and Yoel approve
// (Ilies, 25 Oct 2026). Approve / Reject right here: DIRECTOR logins can't
// open Operations' Changes page. Never an operational change. Hidden when
// nothing is waiting.
export default function DirectorChanges() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ChangeDTO[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/changes?open=1&audience=COMMERCIAL").then(async (r) => setRows(r.ok ? (await r.json()).changes : [])).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  if (!rows.length && !flash) return null;
  return (
    <Card className="mb-4">
      <div className="mb-1 text-sm font-semibold text-gray-100">Changes to approve <span className="font-normal text-gray-500">· {rows.length}</span></div>
      <p className="mb-2 text-[11px] text-gray-500">Contract values proposed from answered questions. Nothing changes until one of you approves it - never the person who gave the figure.</p>
      {flash && <p className="mb-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</p>}
      <div className="space-y-2">{rows.map((c) => <ChangeCard key={c.id} c={c} me={user?.name ?? ""} onDone={(m) => { setFlash(m); load(); }} />)}</div>
    </Card>
  );
}
