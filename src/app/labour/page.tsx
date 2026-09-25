"use client";

import RegisterPage, { StatusPill } from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { effectiveStatus, STATUS_LABEL, STATUS_OPTIONS, whereToday } from "@/lib/resource";

const CATEGORIES = ["Office", "Site Manager", "Truck Driver", "Labourer"];
const SECTION_TITLES: Record<string, string> = {
  Office: "Office",
  "Site Manager": "Site Managers",
  "Truck Driver": "Truck Drivers",
  Labourer: "Labourers",
};

export default function LabourPage() {
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
        columns: [
          { label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
          { label: "Role", render: (r) => r.role },
          { label: "Pay class", render: (r) => r.payClass },
          { label: "Phone", render: (r) => r.phone },
          { label: "Email", render: (r) => r.email },
          { label: "Tickets", render: (r) => r.tickets },
          { label: "Where today", render: (r) => whereToday(r) },
          {
            label: "Status",
            render: (r) => {
              const s = effectiveStatus(r);
              return <StatusPill value={s} label={STATUS_LABEL[s]} />;
            },
          },
        ],
        fields: [
          { key: "name", label: "Name", required: true },
          { key: "category", label: "Group", type: "select", options: CATEGORIES },
          { key: "role", label: "Role", type: "select", options: ["Supervisor", "Lead", "Operator", "Driver", "General labour"] },
          { key: "payClass", label: "Pay class" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "tickets", label: "Tickets / licences", full: true },
          { key: "status", label: "Status", type: "select", options: [{ value: "AVAILABLE", label: "Available (auto)" }, { value: "LEAVE", label: "On leave" }, { value: "DOWN", label: "Unavailable" }] },
          { key: "notes", label: "Notes", type: "textarea" },
        ],
      }}
    />
  );
}
