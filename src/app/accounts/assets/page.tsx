"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { StateChip, dmy, input, type State } from "@/components/compliance/shared";

// Accounts -> Assets (stage 6, docs/accounts/STAGE6-DESIGN.md §2): owned vehicles, plant & attachments, and tools
// from the existing registers, each with its rego / insurance / service dates and open faults.
type DueState = "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED" | "NOT_RECORDED";
type Asset = {
  kind: "resource" | "tool"; id: string; name: string; detail: string; status: string; serviceDueText: string | null; openFaults: number;
  due: { lines: { kind: string; label: string; expiryDate: string | null; state: DueState }[]; worst: DueState };
};
const GROUPS = [["VEHICLES", "Vehicles"], ["PLANT", "Plant & attachments"], ["TOOLS", "Tools"]] as const;
const Chip = ({ s }: { s: DueState }) => (s === "NOT_RECORDED" ? <span className="text-[11px] text-gray-500">not recorded</span> : <StateChip state={s as State} />);

export default function AssetsPage() {
  return <Suspense fallback={null}><Assets /></Suspense>;
}

function Assets() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const group = GROUPS.find(([g]) => g === params.get("group"))?.[0] ?? "VEHICLES";
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [q, setQ] = useState("");
  const [attention, setAttention] = useState(false);
  useEffect(() => {
    setRows(null);
    apiFetch(`/api/accounts/assets?group=${group}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setRows(d.assets));
  }, [group]);
  const list = useMemo(() => (rows ?? []).filter((a) => (!attention || a.due.worst === "EXPIRED" || a.due.worst === "EXPIRING" || a.openFaults > 0)
    && (!q || `${a.name} ${a.detail}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, attention]);

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Assets"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  return (
    <PageShell title="Assets" subtitle="Rego, insurance and service dates for what Lobos owns, service history and fault reports. Dates remind you on To do 30 days ahead.">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {GROUPS.map(([g, l]) => (
          <button key={g} onClick={() => router.replace(g === "VEHICLES" ? "/accounts/assets" : `/accounts/assets?group=${g}`)}
            className={`rounded-full px-3 py-1 ${group === g ? "bg-brand-600 text-white" : "border border-edge text-gray-300"}`}>{l}</button>
        ))}
        <input className={`${input} ml-2 max-w-xs`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5 text-gray-300"><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Needs attention only</label>
      </div>
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-edge text-left text-xs text-gray-500">
              <tr><th className="px-3 py-2">{group === "TOOLS" ? "Tool" : "Asset"}</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Faults</th></tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {list.map((a) => (
                <tr key={a.id} className="hover:bg-panel2">
                  <td className="px-3 py-2"><Link href={`/accounts/assets/${a.kind}/${a.id}`} className="font-medium text-brand-300 hover:underline">{a.name}</Link>{a.detail && <span className="block text-xs text-gray-500">{a.detail}</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {a.due.lines.map((l) => <span key={l.kind} className="inline-flex items-center gap-1 text-gray-400">{l.label}{l.expiryDate ? ` ${dmy(l.expiryDate)}` : ""} <Chip s={l.state} /></span>)}
                    </div>
                    {a.serviceDueText && <span className="mt-0.5 block text-[11px] text-gray-500">Register: service {a.serviceDueText}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{a.status}</td>
                  <td className="px-3 py-2 text-xs">{a.openFaults ? <span className="text-red-300">{a.openFaults} open</span> : <span className="text-gray-500">-</span>}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={4} className="px-3 py-4 text-sm text-gray-500">Nothing matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
