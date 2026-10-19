"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import RegisterPage, { StatusPill } from "@/components/RegisterPage";
import ToolsTabs from "@/components/tools/ToolsTabs";
import RegisterByPhoto from "@/components/tools/RegisterByPhoto";
import ToolDetail from "@/components/tools/ToolDetail";
import { OWNERSHIP_LABEL, TOOL_CONDITIONS, TOOL_OWNERSHIP } from "@/lib/pickTool";
import { ToolDTO } from "@/lib/types";

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-100">{value}</div>
    </div>
  );
}

const conditionPill = (c: string) =>
  c === "Needs repair" || c === "Missing" ? "DOWN" : c === "New" ? "ON_SITE" : c === "Swapped out" ? "LEAVE" : "AVAILABLE";

export default function ToolsPage() {
  const [byPhoto, setByPhoto] = useState<null | (() => Promise<void>)>(null);
  return (
    <>
      <RegisterPage<ToolDTO>
        config={{
          title: "Tools",
          subtitle: "Every tagged tool, its serial number, and the toolbox it belongs in.",
          addLabel: "Add tool by hand",
          itemNoun: "tool",
          api: "/api/tools",
          tabs: <ToolsTabs />,
          extraActions: (reload) => (
            <button
              onClick={() => setByPhoto(() => reload)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-500 px-3.5 py-2 text-sm font-medium text-brand-300 hover:bg-brand-600/20"
            >
              <Camera size={16} /> Register by photo
            </button>
          ),
          searchText: (t) => `${t.tag} ${t.name} ${t.brand ?? ""} ${t.model ?? ""} ${t.serialNumber ?? ""} ${t.heldBy} ${t.toolbox?.name ?? ""}`,
          statusOf: (t) => t.condition,
          statusOptions: TOOL_CONDITIONS.map((c) => ({ value: c, label: c })),
          newDefaults: { condition: "Good", heldBy: "Yard", ownership: "OWNED" },
          header: (rows) => (
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Tile label="Registered" value={rows.filter((t) => t.condition !== "Swapped out").length} />
              <Tile label="In a toolbox" value={rows.filter((t) => t.toolboxId).length} />
              <Tile label="Open faults" value={rows.reduce((n, t) => n + (t.openIssues ?? 0), 0)} />
              <Tile label="Missing" value={rows.filter((t) => t.condition === "Missing").length} />
              <Tile label="No serial yet" value={rows.filter((t) => !t.serialNumber && t.condition !== "Swapped out").length} />
            </div>
          ),
          columns: [
            { label: "Tag", render: (t) => <span className="font-mono text-xs">{t.tag}</span> },
            {
              label: "Tool",
              render: (t) => (
                <span>
                  <span className="font-medium">{t.name}</span>
                  {(t.brand || t.model) && <span className="text-gray-500"> · {[t.brand, t.model].filter(Boolean).join(" ")}</span>}
                </span>
              ),
            },
            { label: "Serial", render: (t) => (t.serialNumber ? <span className="font-mono text-xs">{t.serialNumber}</span> : null) },
            { label: "Toolbox", render: (t) => t.toolbox?.name ?? <span className="text-gray-500">Yard</span> },
            {
              label: "Condition",
              render: (t) => (
                <span className="flex items-center gap-1.5">
                  <StatusPill value={conditionPill(t.condition)} label={t.condition} />
                  {(t.openIssues ?? 0) > 0 && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                      {t.openIssues} fault{t.openIssues === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              ),
            },
            { label: "Ownership", render: (t) => OWNERSHIP_LABEL[t.ownership] ?? t.ownership },
          ],
          fields: [
            { key: "tag", label: "Tag", required: true, placeholder: "LOB-0100" },
            { key: "name", label: "What it is", required: true, placeholder: "e.g. Hammer drill driver" },
            { key: "brand", label: "Brand" },
            { key: "model", label: "Model" },
            { key: "serialNumber", label: "Serial number" },
            { key: "itemNo", label: "Item no. (Hilti FFE)" },
            { key: "manufactured", label: "Manufactured", placeholder: "e.g. 06/2026" },
            { key: "condition", label: "Condition", type: "select", options: [...TOOL_CONDITIONS] },
            { key: "conditionNotes", label: "Damage / wear", full: true },
            { key: "ownership", label: "Ownership", type: "select", options: TOOL_OWNERSHIP.map((o) => ({ value: o, label: OWNERSHIP_LABEL[o] })) },
            { key: "fleetRef", label: "Hilti fleet reference" },
            { key: "lastSeen", label: "Last seen", placeholder: "YYYY-MM-DD" },
            { key: "notes", label: "Notes", type: "textarea" },
          ],
          detail: (t, reload) => <ToolDetail toolId={t.id} reload={reload} />,
        }}
      />
      {byPhoto && <RegisterByPhoto onClose={() => setByPhoto(null)} onSaved={byPhoto} />}
    </>
  );
}
