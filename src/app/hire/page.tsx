"use client";

import { useState } from "react";
import RegisterPage from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { whereToday } from "@/lib/resource";

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
                  tab === t.key ? "bg-blue-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"
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
          { label: "Start", render: (r) => r.hireStart },
          { label: "Expected finish", render: (r) => r.hireEnd },
          { label: "Rate", render: (r) => r.rate },
        ],
        fields: [
          { key: "name", label: isLabour ? "Worker" : "Item", required: true, full: true },
          { key: "agency", label: "Agency / supplier" },
          { key: "role", label: "Role" },
          { key: "hireStart", label: "Start" },
          { key: "hireEnd", label: "Expected finish" },
          { key: "rate", label: "Rate" },
          { key: "notes", label: "Notes", type: "textarea" },
        ],
      }}
    />
  );
}
