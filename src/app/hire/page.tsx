"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import RegisterPage from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { whereToday } from "@/lib/resource";
import { fmtDay, parseISO, parseLooseDate } from "@/lib/dates";
import { hireEstimate, offHireAlert, HIRE_STATUS_LABEL } from "@/lib/hireEstimate";
import { useAuth } from "@/components/AuthProvider";
import PageShell from "@/components/PageShell";
import HireOverview from "@/components/hire/HireOverview";

// Last date this item actually appeared on a job, from its own assignment
// history - not filtered to today, so it reads "still idle" correctly even
// weeks after its last shift.
function lastWorked(r: ResourceDTO): string | null {
  const dates = (r.assignments ?? []).map((a) => a.job.date.slice(0, 10));
  return dates.length ? dates.sort().at(-1)! : null;
}
// Where it was on that last day - the site(s), so the list shows where the
// labour was, not just when (21 Oct 2026).
function lastWorkedWhere(r: ResourceDTO, day: string): string {
  return [...new Set((r.assignments ?? []).filter((a) => a.job.date.slice(0, 10) === day).map((a) => a.job.title))].join(", ");
}

// Prefers the typed offHireDate (Phase 2b) over hireEnd's legacy free text,
// which stays best-effort parsed until re-entered.
function endDate(r: ResourceDTO): Date | null {
  if (r.offHireDate) return parseISO(r.offHireDate);
  return parseLooseDate(r.hireEnd, new Date().getFullYear());
}

function isOverdue(r: ResourceDTO): boolean {
  if (r.hireStatus === "RETURNED") return false;
  const end = endDate(r);
  if (!end) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

const UNIT_SUFFIX: Record<string, string> = { HOUR: "/hr", DAY: "/day", WEEK: "/wk" };
const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const short = (iso: string) => fmtDay(iso, { day: "numeric", month: "short" });
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());

function hireRateSummary(r: ResourceDTO): string {
  if (r.hireRate == null || !r.hireRateUnit) return "—";
  return `$${r.hireRate}${UNIT_SUFFIX[r.hireRateUnit] ?? ""}`;
}

// Hire register (21 Oct 2026): equipment and tools join plant, vehicles and
// labour; each item can carry its project, supplier reference, delivery /
// pick-up and status, and shows an estimated cost (lib/hireEstimate.ts).
// Tabs are split into supplier hire (equipment only) and subcontractors
// (labour hire, plant + operator, trucks) - see lib/hireKinds.ts.
const TABS = [
  { key: "OVERVIEW", label: "Overview", noun: "hire", group: "SUPPLIER" },
  { key: "PLANT", label: "Plant", noun: "plant", group: "SUPPLIER" },
  { key: "EQUIPMENT", label: "Equipment", noun: "equipment", group: "SUPPLIER" },
  { key: "TOOLS", label: "Tools", noun: "tool", group: "SUPPLIER" },
  { key: "LABOUR", label: "Labour hire", noun: "worker", group: "SUBCONTRACT" },
  { key: "WET_HIRE", label: "Plant + operator", noun: "plant + operator", group: "SUBCONTRACT" },
  { key: "VEHICLE", label: "Trucks", noun: "truck", group: "SUBCONTRACT" },
];
const TAB_GROUPS = [
  { key: "SUPPLIER", label: "Supplier hire", hint: "equipment only, no operator" },
  { key: "SUBCONTRACT", label: "Subcontractors", hint: "labour, or plant / trucks with an operator" },
];

type SiteCheck = { answer: "STILL_NEEDED" | "FINISHED" | "NOT_ON_SITE"; by: string; at: string; note: string | null };
const CHECK_TEXT = { STILL_NEEDED: "Still needed", FINISHED: "Finished", NOT_ON_SITE: "Not on site" };
const CHECK_TONE = { STILL_NEEDED: "text-emerald-400", FINISHED: "text-amber-400", NOT_ON_SITE: "text-red-400" };
function SiteCheckCell({ c }: { c?: SiteCheck }) {
  if (!c) return <span className="text-gray-500">—</span>;
  const when = new Date(c.at).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });
  return (
    <span title={c.note ?? undefined}>
      <span className={CHECK_TONE[c.answer]}>{CHECK_TEXT[c.answer]}</span>
      <span className="text-xs text-gray-500"> · {c.by.split(" ")[0]}, {when}</span>
    </span>
  );
}

type OffHireAlertRow = {
  id: string; name: string; category: string | null; supplier: string | null; project: string | null;
  offHireDate: string; level: "OVERDUE" | "TODAY" | "SOON"; daysLeft: number;
};

function ComingOffHire() {
  const [alerts, setAlerts] = useState<OffHireAlertRow[] | null>(null);
  useEffect(() => {
    fetch("/api/hire-alerts")
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d) => setAlerts(d.alerts))
      .catch(() => setAlerts([]));
  }, []);
  if (!alerts || alerts.length === 0) return null;
  const tone = { OVERDUE: "text-red-400", TODAY: "text-amber-400", SOON: "text-amber-300" };
  const say = (a: OffHireAlertRow) =>
    a.level === "OVERDUE" ? `overdue ${-a.daysLeft} day${a.daysLeft === -1 ? "" : "s"}` : a.level === "TODAY" ? "finishes today" : `finishes in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`;
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-amber-400">
        <TriangleAlert size={15} /> Coming off hire ({alerts.length})
      </div>
      <ul className="space-y-0.5 text-xs">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-2">
            <span className={`font-semibold ${tone[a.level]}`}>{say(a)}</span>
            <span className="text-gray-200">{a.name}</span>
            <span className="text-gray-500">
              {a.supplier && `${a.supplier} · `}
              {a.project ?? "no project"} · expected finish {short(a.offHireDate)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-gray-500">Extend the finish date, or call the supplier to off-hire and set the status to Off-hire requested / Returned.</p>
    </div>
  );
}

export default function HirePage() {
  const { canEdit } = useAuth();
  // Overview first (21 Oct 2026): every site's hire at a glance.
  const [tab, setTab] = useState("OVERVIEW");
  const [projects, setProjects] = useState<{ id: string; name: string; status: string }[]>([]);
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);
  // The supervisor's latest answer from the hire check on their site link.
  const [checks, setChecks] = useState<Record<string, SiteCheck>>({});
  useEffect(() => {
    fetch("/api/hire-checks")
      .then((r) => (r.ok ? r.json() : { checks: {} }))
      .then((d) => setChecks(d.checks))
      .catch(() => setChecks({}));
  }, []);
  const t = TABS.find((x) => x.key === tab)!;
  const isLabour = tab === "LABOUR";
  const projectName = (id: string | null | undefined) => (id ? projects.find((p) => p.id === id)?.name ?? "—" : "—");
  const today = todayIso();

  const tabBar = (
    <div className="mb-3 flex flex-wrap gap-3">
      {TAB_GROUPS.map((g) => (
        <div
          key={g.key}
          className={`rounded-lg border px-2 pb-2 pt-1 ${g.key === "SUBCONTRACT" ? "border-rose-500/40 bg-rose-500/5" : "border-edge bg-panel/40"}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-widest text-gray-500">
            <span className={`font-semibold ${g.key === "SUBCONTRACT" ? "text-rose-300" : "text-gray-300"}`}>{g.label}</span> · {g.hint}
          </div>
          <div className="flex flex-wrap gap-1">
            {TABS.filter((x) => x.group === g.key).map((x) => (
              <button
                key={x.key}
                onClick={() => setTab(x.key)}
                className={`rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                  tab === x.key ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
  const isSub = t.group === "SUBCONTRACT";

  if (tab === "OVERVIEW") {
    return (
      <PageShell title="Hire" subtitle="Everything on hire across all sites, site by site - supplier hire and subcontractors kept separate - who it's from, when it's due back and roughly what it's costing.">
        {tabBar}
        <ComingOffHire />
        <HireOverview canSeeMoney={canEdit} onOpenTab={setTab} />
      </PageShell>
    );
  }

  return (
    <RegisterPage<ResourceDTO>
      key={tab}
      config={{
        title: isSub ? "Hire · Subcontractors" : "Hire · Supplier hire",
        subtitle: isSub
          ? "Subcontractors: labour hire, and plant or trucks that come with an operator / driver."
          : "Equipment hired from a supplier, no operator: who it's from, which project, roughly what it costs, and when it's due back.",
        addLabel: `Add ${t.noun} hire`,
        itemNoun: `${t.noun} hire`,
        api: "/api/resources",
        query: `type=HIRE&category=${tab}`,
        searchText: (r) => `${r.name} ${r.agency} ${r.role} ${r.hireRef ?? ""} ${projectName(r.hireProjectId)}`,
        newDefaults: { type: "HIRE", category: tab, ownership: "HIRED", role: isLabour ? "General labour" : "", hireStatus: isLabour ? "" : "BOOKED" },
        header: () => <ComingOffHire />,
        tabs: tabBar,
        columns: [
          { label: isLabour ? "Worker" : "Item", render: (r) => <span className="font-medium">{r.name}</span> },
          { label: isLabour ? "Agency" : isSub ? "Subcontractor" : "Supplier", render: (r) => r.agency },
          ...(isLabour
            ? [
                { label: "Role", render: (r: ResourceDTO) => r.role },
                { label: "Where today", render: (r: ResourceDTO) => whereToday(r) },
              ]
            : [
                { label: "Project", render: (r: ResourceDTO) => projectName(r.hireProjectId) },
                { label: "Status", render: (r: ResourceDTO) => (r.hireStatus ? HIRE_STATUS_LABEL[r.hireStatus] ?? r.hireStatus : "—") },
                { label: "From site", render: (r: ResourceDTO) => <SiteCheckCell c={checks[r.id]} /> },
              ]),
          {
            label: "Start",
            render: (r) => (r.onHireDate ? short(r.onHireDate) : r.hireStart),
          },
          {
            label: "Expected finish",
            render: (r) => {
              const label = r.offHireDate ? short(r.offHireDate) : r.hireEnd;
              const a = offHireAlert(r, today);
              if (isOverdue(r) || a?.level === "OVERDUE") {
                return (
                  <span className="inline-flex items-center gap-1 text-red-400">
                    <TriangleAlert size={12} className="shrink-0" />
                    {label} · overdue
                  </span>
                );
              }
              if (a) return <span className="text-amber-400">{label} · {a.level === "TODAY" ? "today" : `${a.daysLeft}d`}</span>;
              return label;
            },
          },
          ...(isLabour
            ? [
                {
                  label: "Last worked",
                  render: (r: ResourceDTO) => {
                    const d = lastWorked(r);
                    if (!d) return <span className="text-gray-500">Never</span>;
                    const where = lastWorkedWhere(r, d);
                    return (
                      <span>
                        {short(d)}
                        {where && <span className="text-gray-500"> · {where}</span>}
                      </span>
                    );
                  },
                },
              ]
            : []),
          ...(canEdit ? [{ label: "Rate", render: (r: ResourceDTO) => hireRateSummary(r) }] : []),
          ...(canEdit && !isLabour
            ? [
                {
                  label: "Est. cost",
                  render: (r: ResourceDTO) => {
                    const e = hireEstimate(r, today);
                    if (!e) return <span className="text-gray-500">no start date</span>;
                    if (e.costToDate == null) return <span className="text-gray-500">no rate</span>;
                    return (
                      <span title="Estimate: rate × working days on hire + delivery / pick-up">
                        {money(e.costToDate)}
                        {e.costTotal != null && <span className="text-gray-500"> of ~{money(e.costTotal)}</span>}
                      </span>
                    );
                  },
                },
              ]
            : []),
        ],
        fields: [
          {
            key: "name",
            label: isLabour ? "Worker" : "Item",
            required: true,
            full: true,
            placeholder: isLabour ? "" : tab === "WET_HIRE" ? "e.g. Road saw + operator, 5t excavator wet hire" : tab === "VEHICLE" ? "e.g. Tipper + driver" : "e.g. 5t excavator, EWP 19ft scissor, road saw",
          },
          {
            key: "agency",
            label: isLabour ? "Agency" : isSub ? "Subcontractor" : "Supplier",
            placeholder: isSub ? "e.g. Envirocut" : "e.g. Hire Express, Allcott Hire",
          },
          ...(isLabour
            ? [{ key: "role", label: "Role" }]
            : [
                {
                  key: "hireProjectId",
                  label: "Project",
                  type: "select" as const,
                  options: [
                    { value: "", label: "— not for a project —" },
                    ...projects.filter((p) => p.status === "ACTIVE").map((p) => ({ value: p.id, label: p.name })),
                  ],
                },
                {
                  key: "hireStatus",
                  label: "Status",
                  type: "select" as const,
                  options: [
                    { value: "BOOKED", label: "Booked" },
                    { value: "ON_HIRE", label: "On hire" },
                    { value: "OFF_HIRE_REQUESTED", label: "Off-hire requested" },
                    { value: "RETURNED", label: "Returned" },
                  ],
                },
                { key: "hireRef", label: "Hire / docket no." },
              ]),
          { key: "onHireDate", label: "Start", type: "date" },
          { key: "offHireDate", label: isLabour ? "Expected finish" : "Expected finish (or returned date)", type: "date" },
          { key: "hireRate", label: "Rate (ex GST)", type: "number", placeholder: "e.g. 450" },
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
          ...(isLabour
            ? []
            : [
                { key: "hireDeliveryCost", label: "Delivery charge (ex GST)", type: "number" as const },
                { key: "hireCollectionCost", label: "Pick-up charge (ex GST)", type: "number" as const },
                { key: "hireSource", label: "Source (email / quote)", full: true, placeholder: "e.g. Email: Hire Express, 16 Oct 2026, 'Confirmation email'" },
              ]),
          { key: "hireStart", label: "Legacy start note (free text, being phased out)" },
          { key: "hireEnd", label: "Legacy finish note (free text, being phased out)" },
          { key: "rate", label: "Legacy rate note (free text, being phased out)", full: true },
          { key: "notes", label: "Notes", type: "textarea" },
        ],
      }}
    />
  );
}
