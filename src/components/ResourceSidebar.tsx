"use client";

import { useMemo, useState } from "react";
import { DragResourcePayload, ResourceDTO } from "@/lib/types";
import { isQuickLabourHire, NEW_LABOUR_HIRE } from "@/lib/resource";
import ResourceCard from "./ResourceCard";
import ReportBugButton from "./ReportBugButton";
import YardBin from "./YardBin";
import FormModal, { FieldDef } from "./FormModal";
import { useAuth } from "./AuthProvider";

type GroupKey = "crew" | "plant" | "attach" | "vehicles" | "hire";

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "crew", label: "Crew" },
  { key: "plant", label: "Plant" },
  { key: "attach", label: "Attachments" },
  { key: "vehicles", label: "Vehicles" },
  { key: "hire", label: "Hire" },
];

const HIRE_CATEGORIES = [
  { value: "LABOUR", label: "Personnel (labour hire)" },
  { value: "PLANT", label: "Machine (plant hire)" },
  { value: "VEHICLE", label: "Truck (subcontractor)" },
];

const HIRE_FIELDS: FieldDef[] = [
  { key: "category", label: "Kind", type: "select", options: HIRE_CATEGORIES, full: true },
  { key: "name", label: "Name / item", required: true, full: true },
  { key: "agency", label: "Agency / supplier" },
  { key: "role", label: "Role" },
  { key: "onHireDate", label: "Start", type: "date" },
  { key: "offHireDate", label: "Expected finish", type: "date" },
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
  { key: "notes", label: "Notes", type: "textarea", full: true },
];

function groupOf(r: ResourceDTO): GroupKey {
  switch (r.type) {
    case "PERSONNEL":
      return "crew";
    case "EQUIPMENT":
      return "plant";
    case "ATTACHMENT":
      return "attach";
    case "VEHICLE":
      return "vehicles";
    default:
      return "hire";
  }
}

export default function ResourceSidebar({
  resources,
  selectedDate,
  onUnassign,
  onResourcesChanged,
}: {
  resources: ResourceDTO[];
  selectedDate: string;
  onUnassign: (assignmentId: string) => void;
  onResourcesChanged: () => void | Promise<void>;
}) {
  const { canEdit } = useAuth();
  const [dropActive, setDropActive] = useState(false);
  const [addingHire, setAddingHire] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Dropping an assigned chip back on the Yard removes it from its job.
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    try {
      const payload = JSON.parse(e.dataTransfer.getData("application/json"));
      if (payload?.assignmentId) onUnassign(payload.assignmentId);
    } catch {
      // ignore malformed payloads
    }
  }

  async function deleteResource(resourceId: string, name: string) {
    if (!canEdit) return;
    if (!confirm(`Remove "${name}" from inventory? It won't show in the Yard or any register again. This can't be undone from here.`)) return;
    const res = await fetch(`/api/resources/${resourceId}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage(`Couldn't remove ${name}. Try again.`);
      return;
    }
    setMessage(`Removed ${name} from inventory.`);
    await onResourcesChanged();
  }

  async function updateRole(resourceId: string, role: string) {
    if (!canEdit) return;
    const res = await fetch(`/api/resources/${resourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: role || null }),
    });
    if (!res.ok) {
      setMessage("Couldn't update that role. Try again.");
      return;
    }
    await onResourcesChanged();
  }

  async function addHire(v: Record<string, any>) {
    const res = await fetch("/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: v.name,
        type: "HIRE",
        category: v.category,
        ownership: "HIRED",
        agency: v.agency || null,
        role: v.role || null,
        onHireDate: v.onHireDate || null,
        offHireDate: v.offHireDate || null,
        hireRate: v.hireRate || null,
        hireRateUnit: v.hireRateUnit || null,
        notes: v.notes || null,
      }),
    });
    if (!res.ok) throw new Error("Couldn't add that hire");
    await onResourcesChanged();
  }

  // The "Labour hire" box: every drag onto a job's crew cell creates a new
  // "Labour hire N" tile on that job (Board.handleAssign does the creating).
  function onLabourHireDragStart(e: React.DragEvent) {
    const payload: DragResourcePayload = {
      resourceId: NEW_LABOUR_HIRE,
      resourceName: "Labour hire",
      column: "crew",
    };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  }

  const [open, setOpen] = useState<Record<GroupKey, boolean>>({
    crew: true,
    plant: true,
    attach: false,
    vehicles: false,
    hire: false,
  });
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const by: Record<GroupKey, ResourceDTO[]> = {
      crew: [],
      plant: [],
      attach: [],
      vehicles: [],
      hire: [],
    };
    for (const r of resources) {
      if (isQuickLabourHire(r)) continue; // these only live on the job they were dropped on
      if (q &&!`${r.name} ${r.role ?? ""} ${r.detail ?? ""}`.toLowerCase().includes(q)) continue;
      // Once it's on a job today, dragging from here is a move: it leaves the Yard
      // until it's unassigned (or dragged back onto the Yard), so there's one copy
      // of it in play at a time, not a duplicate sitting in both places.
      const assignedToday = (r.assignments ?? []).some(
        (a) => a.job?.date?.slice(0, 10) === selectedDate
      );
      if (assignedToday) continue;
      by[groupOf(r)].push(r);
    }
    return by;
  }, [resources, query, selectedDate]);

  return (
    <aside
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={onDrop}
      className={`flex w-56 shrink-0 flex-col gap-2 border-r border-edge bg-panel p-3 ${
        dropActive ? "drop-zone-active" : ""
      }`}
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">
          The Yard
        </div>
        <div className="text-[11px] text-gray-500">
          Drag crew, plant, vehicles &amp; hire onto a job
        </div>
      </div>

      <ReportBugButton />

      {message && (
        <div className="rounded-md bg-panel2 px-2 py-1 text-[11px] text-gray-400">{message}</div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
        className="rounded-md border border-edge bg-panel2 px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />

      {canEdit && (
        <div
          draggable
          onDragStart={onLabourHireDragStart}
          title="Drag onto a job's crew to add a labour hire tile - every drag adds a new one"
          className="cursor-grab rounded-md border-2 border-dashed border-yellow-400 bg-yellow-400/10 px-2 py-1.5 text-sm font-medium text-yellow-300 hover:bg-yellow-400/20 active:cursor-grabbing"
        >
          + Labour hire <span className="text-[11px] font-normal text-yellow-300/70">(drag onto a job)</span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {GROUPS.map((g) => {
          const list = grouped[g.key];
          // Searching auto-opens groups that have matches.
          const isOpen = open[g.key] || (query.trim() !== "" && list.length > 0);
          return (
            <div key={g.key}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                className="mb-1 flex w-full items-center justify-between text-left text-sm font-semibold text-gray-300"
              >
                <span>
                  {g.label} <span className="text-gray-500">{list.length}</span>
                </span>
                <span className="text-gray-500">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-1">
                  {g.key === "hire" && canEdit && (
                    <button
                      onClick={() => setAddingHire(true)}
                      className="mb-0.5 rounded-md border border-dashed border-edge px-2 py-1 text-left text-xs text-gray-400 hover:border-brand-500/60 hover:text-gray-200"
                    >
                      + Add hire (personnel, machine or truck)
                    </button>
                  )}
                  {list.length === 0 && (
                    <div className="px-1 text-xs text-gray-600">None</div>
                  )}
                  {list.map((r) => (
                    <ResourceCard
                      key={r.id}
                      resource={r}
                      onRoleChange={g.key === "crew" && canEdit ? updateRole : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pinned in the panel's own layout (not viewport-fixed), so it never
          drifts over other controls and never scrolls out of view. */}
      {canEdit && <YardBin onDelete={deleteResource} />}

      {addingHire && (
        <FormModal
          title="Add hire"
          fields={HIRE_FIELDS}
          initial={{ category: "LABOUR" }}
          onSave={addHire}
          onClose={() => setAddingHire(false)}
          submitLabel="Add hire"
        />
      )}
    </aside>
  );
}
