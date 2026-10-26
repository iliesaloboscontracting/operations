"use client";

import { useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { EMPLOYMENT_TYPES } from "@/lib/compliance/rules";
import { btnPrimary, input } from "./shared";

// Onboarding details for a worker (stage 5), kept apart from pay. TFN, bank and super details are never asked for
// here: they stay in Xero, and this form only records that they were set up there.
export type OnboardingDTO = {
  startDate: string | null; employmentType: string | null; abn: string | null; address: string | null; dateOfBirth: string | null;
  emergencyName: string | null; emergencyPhone: string | null; emergencyRelation: string | null; xeroSetUp: boolean;
  contractSigned: string | null; policiesSigned: string | null; inductionDate: string | null; notes: string | null;
  updatedBy?: string; updatedAt?: string;
} | null;

export default function OnboardingForm({ resourceId, value, onSaved }: { resourceId: string; value: OnboardingDTO; onSaved: () => void }) {
  const [f, setF] = useState({
    startDate: value?.startDate ?? "", employmentType: value?.employmentType ?? "", abn: value?.abn ?? "", address: value?.address ?? "",
    dateOfBirth: value?.dateOfBirth ?? "", emergencyName: value?.emergencyName ?? "", emergencyPhone: value?.emergencyPhone ?? "",
    emergencyRelation: value?.emergencyRelation ?? "", contractSigned: value?.contractSigned ?? "", policiesSigned: value?.policiesSigned ?? "",
    inductionDate: value?.inductionDate ?? "", notes: value?.notes ?? "",
  });
  const [xero, setXero] = useState(!!value?.xeroSetUp);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await apiFetch(`/api/compliance/workers/${resourceId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, xeroSetUp: xero }) });
    setBusy(false);
    if (!res.ok) return setMsg({ text: await serverErrorMessage(res, "Couldn't save."), error: true });
    setMsg({ text: "Saved." });
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Start date<input type="date" className={input} value={f.startDate} onChange={set("startDate")} /></label>
        <label className="text-xs text-gray-400">Employment<select className={input} value={f.employmentType} onChange={set("employmentType")}><option value="">-</option>{EMPLOYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs text-gray-400">ABN (contractors)<input className={input} value={f.abn} onChange={set("abn")} inputMode="numeric" /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* No date of birth: the lead recommended leaving it out unless accounts need it; Ilies said go (27 Oct 2026). */}
        <label className="text-xs text-gray-400 sm:col-span-3">Address<input className={input} value={f.address} onChange={set("address")} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Emergency contact<input className={input} value={f.emergencyName} onChange={set("emergencyName")} /></label>
        <label className="text-xs text-gray-400">Their phone<input className={input} value={f.emergencyPhone} onChange={set("emergencyPhone")} inputMode="tel" /></label>
        <label className="text-xs text-gray-400">Relationship<input className={input} value={f.emergencyRelation} onChange={set("emergencyRelation")} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Contract signed<input type="date" className={input} value={f.contractSigned} onChange={set("contractSigned")} /></label>
        <label className="text-xs text-gray-400">Policies signed<input type="date" className={input} value={f.policiesSigned} onChange={set("policiesSigned")} /></label>
        <label className="text-xs text-gray-400">Company induction<input type="date" className={input} value={f.inductionDate} onChange={set("inductionDate")} /></label>
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-300">
        <input type="checkbox" className="mt-0.5" checked={xero} onChange={(e) => setXero(e.target.checked)} />
        <span>TFN, bank and super set up in Xero<span className="block text-xs text-gray-500">Those details stay in Xero only - never type them here.</span></span>
      </label>
      <textarea className={input} rows={2} placeholder="Notes" value={f.notes} onChange={set("notes")} />
      <div className="flex items-center gap-3">
        <button disabled={busy} className={btnPrimary}>Save onboarding</button>
        {msg && <span className={`text-xs ${msg.error ? "text-red-400" : "text-emerald-300"}`}>{msg.text}</span>}
        {value?.updatedBy && <span className="text-xs text-gray-500">Last saved by {value.updatedBy}</span>}
      </div>
    </form>
  );
}
