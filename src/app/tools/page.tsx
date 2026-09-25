"use client";

import RegisterPage, { StatusPill } from "@/components/RegisterPage";
import { ToolDTO } from "@/lib/types";

const CONDITIONS = ["New", "Good", "Needs repair", "Missing"];

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-100">{value}</div>
    </div>
  );
}

export default function ToolsPage() {
  return (
    <RegisterPage<ToolDTO>
      config={{
        title: "Tools",
        subtitle: "Tagged small tools and who is holding them.",
        addLabel: "Add tool",
        itemNoun: "tool",
        api: "/api/tools",
        searchText: (t) => `${t.tag} ${t.name} ${t.model} ${t.heldBy}`,
        statusOf: (t) => t.condition,
        statusOptions: CONDITIONS.map((c) => ({ value: c, label: c })),
        newDefaults: { condition: "Good", heldBy: "Yard" },
        header: (rows) => (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Registered" value={rows.length} />
            <Tile label="Missing" value={rows.filter((t) => t.condition === "Missing").length} />
            <Tile label="Down or needs repair" value={rows.filter((t) => t.condition === "Needs repair").length} />
            <Tile label="Unallocated (yard)" value={rows.filter((t) => t.heldBy === "Yard").length} />
          </div>
        ),
        columns: [
          { label: "Tag", render: (t) => <span className="font-mono text-xs">{t.tag}</span> },
          { label: "Tool", render: (t) => <span className="font-medium">{t.name}</span> },
          { label: "Model / serial", render: (t) => t.model },
          {
            label: "Condition",
            render: (t) => (
              <StatusPill
                value={t.condition === "Needs repair" || t.condition === "Missing" ? "DOWN" : t.condition === "New" ? "ON_SITE" : "AVAILABLE"}
                label={t.condition}
              />
            ),
          },
          { label: "Held by", render: (t) => t.heldBy },
          { label: "Last seen", render: (t) => t.lastSeen },
        ],
        fields: [
          { key: "tag", label: "Tag", required: true, placeholder: "LOB-0100" },
          { key: "name", label: "Tool", required: true },
          { key: "model", label: "Model / serial", full: true },
          { key: "condition", label: "Condition", type: "select", options: CONDITIONS },
          { key: "heldBy", label: "Held by", placeholder: "Yard / person / site" },
          { key: "lastSeen", label: "Last seen", placeholder: "YYYY-MM-DD" },
          { key: "notes", label: "Notes", type: "textarea" },
        ],
      }}
    />
  );
}
