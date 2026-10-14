"use client";

import RegisterPage, { StatusPill } from "@/components/RegisterPage";
import { FieldDef } from "@/components/FormModal";
import { RegColumn } from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { effectiveStatus, money, REGISTER_ROLE_OPTIONS, STATUS_LABEL, STATUS_OPTIONS, whereToday } from "@/lib/resource";
import { useAuth } from "@/components/AuthProvider";

const CATEGORIES = ["Office", "Site Manager", "Truck Driver", "Labourer"];
const SECTION_TITLES: Record<string, string> = {
  Office: "Office",
  "Site Manager": "Site Managers",
  "Truck Driver": "Truck Drivers",
  Labourer: "Labourers",
};

// A short "$X/hr" / "$X/day" / "$X/yr" summary for the register table - the
// full breakdown (night/travel/regional/weekend loadings) only shows in the
// edit form.
function payRateSummary(r: ResourceDTO): string {
  if (r.payRateBasis === "SALARY") return r.annualSalary ? `${money(r.annualSalary)}/yr` : "TBC";
  if (r.payRateBasis === "DAY_RATE") return r.ordinaryRate ? `${money(r.ordinaryRate)}/day` : "TBC";
  if (r.payRateBasis === "HOURLY") return r.ordinaryRate ? `${money(r.ordinaryRate)}/hr` : "TBC";
  return "TBC";
}

const PAY_RATE_FIELDS: FieldDef[] = [
  {
    key: "payRateBasis",
    label: "Pay basis",
    type: "select",
    section: "Pay rate (Admin only)",
    options: [
      { value: "", label: "— not set —" },
      { value: "HOURLY", label: "Hourly" },
      { value: "SALARY", label: "Salary" },
      { value: "DAY_RATE", label: "Day rate" },
    ],
  },
  { key: "annualSalary", label: "Annual salary", type: "number", placeholder: "e.g. 100000" },
  { key: "ordinaryRate", label: "Ordinary rate", type: "number", placeholder: "e.g. 45" },
  { key: "nightRate", label: "Night rate", type: "number" },
  { key: "travelRate", label: "Driving/tools/travel rate", type: "number" },
  { key: "regionalDayRate", label: "Regional day rate", type: "number" },
  { key: "regionalNightRate", label: "Regional night rate", type: "number" },
  { key: "saturdayRate", label: "Saturday rate", type: "number" },
  { key: "sundayRate", label: "Sunday rate", type: "number" },
  {
    key: "payRateConfirmed",
    label: "Confirmed?",
    type: "select",
    options: [
      { value: "false", label: "TBC - not yet confirmed" },
      { value: "true", label: "Confirmed" },
    ],
  },
  { key: "payRateNotes", label: "Pay rate notes", type: "textarea", full: true },
];

export default function LabourPage() {
  const { isAdmin } = useAuth();

  const columns: RegColumn<ResourceDTO>[] = [
    { label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
    { label: "Role", render: (r) => r.role },
    { label: "Pay class", render: (r) => r.payClass },
    { label: "Phone", render: (r) => r.phone },
    { label: "Email", render: (r) => r.email },
    { label: "Where today", render: (r) => whereToday(r) },
    {
      label: "Status",
      render: (r) => {
        const s = effectiveStatus(r);
        return <StatusPill value={s} label={STATUS_LABEL[s]} />;
      },
    },
  ];
  if (isAdmin) {
    columns.push({
      label: "Pay rate",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {payRateSummary(r)}
          {!r.payRateConfirmed && (
            <span className="rounded-full bg-amber-900/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
              TBC
            </span>
          )}
        </span>
      ),
    });
  }

  return (
    <RegisterPage<ResourceDTO>
      config={{
        title: "Labour",
        subtitle: "Our own crew.",
        addLabel: "Add worker",
        itemNoun: "worker",
        api: "/api/resources",
        query: "type=PERSONNEL",
        sectionOf: (r) => SECTION_TITLES[r.category ?? ""] ?? r.category ?? "Other",
        sectionOrder: Object.values(SECTION_TITLES),
        searchText: (r) => `${r.name} ${r.role} ${r.phone} ${r.email} ${r.tickets}`,
        statusOf: effectiveStatus,
        statusOptions: STATUS_OPTIONS,
        newDefaults: { type: "PERSONNEL", category: "Labourer", role: "General labour", payClass: "Labourer", status: "AVAILABLE" },
        columns,
        fields: [
          { key: "name", label: "Name", required: true },
          { key: "category", label: "Group", type: "select", options: CATEGORIES },
          { key: "role", label: "Role", type: "select", options: REGISTER_ROLE_OPTIONS },
          { key: "payClass", label: "Pay class" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "tickets", label: "Tickets / licences", full: true },
          { key: "status", label: "Status", type: "select", options: [{ value: "AVAILABLE", label: "Available (auto)" }, { value: "LEAVE", label: "On leave" }, { value: "DOWN", label: "Unavailable" }] },
          { key: "notes", label: "Notes", type: "textarea" },
          ...(isAdmin ? PAY_RATE_FIELDS : []),
        ],
      }}
    />
  );
}
