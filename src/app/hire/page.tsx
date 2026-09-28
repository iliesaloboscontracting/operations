"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import RegisterPage from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { whereToday } from "@/lib/resource";
import { fmtDay, parseISO, parseLooseDate } from "@/lib/dates";

// Last date this item actually appeared on a job, from its own assignment
// history - not filtered to today, so it reads "still idle" correctly even
// weeks after its last shift.
function lastWorked(r: ResourceDTO): string | null {
  const dates = (r.assignments ?? []).map((a) => a.job.date.slice(0, 10));
  return dates.length ? dates.sort().at(-1)! : null;
}

// Prefers the typed offHireDate (Phase 2b) over hireEnd's legacy free text,
// which stays best-effort parsed until re-entered.
function endDate(r: ResourceDTO): Date | null {
  if (r.offHireDate) return parseISO(r.offHireDate);
  return parseLooseDate(r.hireEnd, new Date().getFullYear());
}

function isOverdue(r: ResourceDTO): boolean {
  const end = endDate(r);
  if (!end) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

const UNIT_SUFFIX: Record<string, string> = { HOUR: "/hr", DAY: "/day", WEEK: "/wk" };

function hireRateSummary(r: ResourceDTO): string {
  if (r.hireRate == null || !r.hireRateUnit) return "—";
  return `$${r.hireRate}${UNIT_SUFFIX[r.hireRateUnit] ?? ""}`;
}

const TABS = [
  { key: "PLANT", label: "Plant" },
  { key: "LABOUR", label: "Labour" },
  { key: "VEHICLE", label: "Vehicles" },
];

export default function HirePage() {
  const [tab, setTab] = useState("LABOUR");
  const isLabour = tab === "LABOUR";
  const noun = isLabour ? "worker" : tab === "PLANT" ? "plant" : "vehicle";

  return (
    <RegisterPage<ResourceDTO>
      key={tab}
      config={{
        title: "Hire",
        subtitle: "Everything bought in. Make the hire here with its details; place it from the Command Centre like anything we own.",
        addLabel: `Add ${noun} hire`,
        itemNoun: `${noun} hire`,
        api: "/api/resources",
        query: `type=HIRE&category=${tab}`,
        searchText: (r) => `${r.name} ${r.agency} ${r.role}`,
        newDefaults: { type: "HIRE", category: tab, ownership: "HIRED", role: isLabour ? "General labour" : "" },
        tabs: (
          <div className="mb-3 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                  tab === t.key ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ),
        columns: [
          { label: isLabour ? "Worker" : "Item", render: (r) => <span className="font-medium">{r.name}</span> },
          { label: "Agency / supplier", render: (r) => r.agency },
          { label: "Role", render: (r) => r.role },
          { label: "Where today", render: (r) => whereToday(r) },
          {
            label: "Start",
            render: (r) => (r.onHireDate ? fmtDay(r.onHireDate, { day: "numeric", month: "short" }) : r.hireStart),
          },
          {
            label: "Expected finish",
            render: (r) => {
              const label = r.offHireDate ? fmtDay(r.offHireDate, { day: "numeric", month: "short" }) : r.hireEnd;
              return isOverdue(r) ? (
                <span className="inline-flex items-center gap-1 text-red-400">
                  <TriangleAlert size={12} className="shrink-0" />
                  {label}
                </span>
              ) : (
                label
              );
            },
          },
          {
            label: "Last worked",
            render: (r) => {
              const d = lastWorked(r);
              return d ? fmtDay(d, { day: "numeric", month: "short" }) : <span className="text-gray-500">Never</span>;
            },
          },
          { label: "Rate", render: (r) => hireRateSummary(r) },
        ],
        fields: [
          { key: "name", label: isLabour ? "Worker" : "Item", required: true, full: true },
          { key: "agency", label: "Agency / supplier" },
          { key: "role", label: "Role" },
          { key: "onHireDate", label: "Start", type: "date" },
          { key: "offHireDate", label: "Expected finish", type: "date" },
          { key: "hireStart", label: "Legacy start note (free text, being phased out)" },
          { key: "hireEnd", label: "Legacy finish note (free text, being phased out)" },
          { key: "hireRate", label: "Rate", type: "number", placeholder: "e.g. 45" },
          {
            key: "hireRateUnit",
            label: "Per",
            type: "select",
            options: [
              { value: "", label: "— not set —" },
              { value: "HOUR", label: "Hour" },
              { value: "DAY", label: "Day" },
              { value: "WEEK", label: "Week" },
            ],
          },
          { key: "rate", label: "Legacy rate note (free text, being phased out)", full: true },
          { key: "notes", label: "Notes", type: "textarea" },
        ],
      }}
    />
  );
}
