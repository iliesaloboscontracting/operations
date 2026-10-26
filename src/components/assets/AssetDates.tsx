"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import type { ManagerDate } from "@/lib/assets/rules";

// D4 (Ilies, 27 Oct 2026): rego / insurance / service expiry on the Vehicles and Plant pages, read only, for Managers
// and Admins (the route refuses a Viewer). Accounts keep and edit them, with the files, on Accounts -> Assets.
type Dates = Record<string, ManagerDate[]>;
const Ctx = createContext<Dates>({});

export function AssetDatesProvider({ children }: { children: React.ReactNode }) {
  const { canEdit } = useAuth();
  const [dates, setDates] = useState<Dates>({});
  useEffect(() => {
    if (!canEdit) return;
    apiFetch("/api/assets/dates").then((r) => (r.ok ? r.json() : null)).then((d) => d && setDates(d.dates ?? {})).catch(() => undefined);
  }, [canEdit]);
  return <Ctx.Provider value={dates}>{children}</Ctx.Provider>;
}

const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "no date");
// The register's columns are narrow: short names in the cell, the full wording in its tooltip and the item's panel.
const SHORT: Record<string, string> = { REGO: "Rego", ASSET_INSURANCE: "Ins.", SERVICE_DUE: "Service", PLANT_INSPECTION: "Insp." };
const short = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : "-");
const TONE: Record<string, string> = { EXPIRED: "text-red-300", EXPIRING: "text-amber-300", VALID: "text-gray-300", NO_EXPIRY: "text-gray-400" };
const describe = (d: ManagerDate) => [d.label, d.issuer, d.reference].filter(Boolean).join(" · ");

// The column: one short line per date, red when expired and amber within 30 days (the tooltip says which).
export function AssetDatesCell({ resourceId }: { resourceId: string }) {
  const list = useContext(Ctx)[resourceId];
  if (!list?.length) return null;
  return (
    <span className="flex flex-col text-xs">
      {list.map((d, i) => (
        <span key={i} title={`${describe(d)} - ${d.state === "EXPIRED" ? "expired" : d.state === "EXPIRING" ? "within 30 days" : "OK"}`} className={`whitespace-nowrap ${TONE[d.state] ?? ""}`}>
          {SHORT[d.kind] ?? d.label} {short(d.expiryDate)}
        </span>
      ))}
    </span>
  );
}

// In the item's panel: the same dates with who issued them and the number.
export function AssetDatesPanel({ resourceId }: { resourceId: string }) {
  const { canEdit } = useAuth();
  const list = useContext(Ctx)[resourceId];
  if (!canEdit) return null;
  return (
    <div className="mt-4 rounded-lg border border-edge p-3">
      <p className="mb-1 text-xs font-semibold text-gray-300">Rego, insurance and service dates</p>
      {!list?.length ? <p className="text-xs text-gray-500">None recorded. Accounts keep these on Accounts → Assets.</p> : (
        <ul className="space-y-0.5 text-xs">
          {list.map((d, i) => <li key={i} className={TONE[d.state] ?? ""}>{describe(d)} - {d.expiryDate ? `${d.kind === "SERVICE_DUE" ? "due" : "expires"} ${dmy(d.expiryDate)}` : "no date"}{d.state === "EXPIRED" ? " (expired)" : d.state === "EXPIRING" ? " (within 30 days)" : ""}</li>)}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-gray-500">Read only - accounts update them.</p>
    </div>
  );
}
