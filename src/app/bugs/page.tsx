"use client";

import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import FormModal, { FieldDef } from "@/components/FormModal";
import { BugReportDTO } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-red-900/60 text-red-300",
  IN_PROGRESS: "bg-amber-900/60 text-amber-300",
  FIXED: "bg-emerald-900/60 text-emerald-300",
  WONT_FIX: "bg-gray-700 text-gray-300",
};
const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  FIXED: "Fixed",
  WONT_FIX: "Won't fix",
};
const SEVERITY_STYLE: Record<string, string> = {
  LOW: "text-gray-500",
  MEDIUM: "text-amber-500",
  HIGH: "text-red-500",
};

function timeAgo(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const FIELDS: FieldDef[] = [
  { key: "title", label: "Title", required: true, full: true },
  { key: "description", label: "Description", type: "textarea", full: true },
  {
    key: "severity",
    label: "Severity",
    type: "select",
    options: [
      { value: "LOW", label: "Low" },
      { value: "MEDIUM", label: "Medium" },
      { value: "HIGH", label: "High" },
    ],
  },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "OPEN", label: "Open" },
      { value: "IN_PROGRESS", label: "In progress" },
      { value: "FIXED", label: "Fixed" },
      { value: "WONT_FIX", label: "Won't fix" },
    ],
  },
  { key: "notes", label: "Resolution notes", type: "textarea", full: true },
];

export default function BugReportsPage() {
  const { canEdit } = useAuth();
  const [bugs, setBugs] = useState<BugReportDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<BugReportDTO | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/bugs");
    if (res.ok) setBugs(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = bugs.filter((b) => !status || b.status === status);
  const openCount = bugs.filter((b) => b.status === "OPEN").length;

  async function save(v: Record<string, any>) {
    if (!editing) return;
    const res = await fetch(`/api/bugs/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    });
    if (!res.ok) throw new Error("Couldn't save");
    await load();
  }

  async function remove() {
    if (!editing) return;
    const res = await fetch(`/api/bugs/${editing.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Couldn't delete");
    await load();
  }

  return (
    <PageShell
      title="Bug Reports"
      subtitle={`Reported from the "Report a bug" button anywhere in the app. ${openCount} open.`}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {["", "OPEN", "IN_PROGRESS", "FIXED", "WONT_FIX"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              status === s ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"
            }`}
          >
            {s ? STATUS_LABEL[s] : "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge py-10 text-center text-sm text-gray-500">
          {bugs.length === 0 ? "No bugs reported yet — good sign." : "Nothing at this status."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge">
          <div className="grid grid-cols-[1.8fr_0.9fr_1fr_0.9fr] gap-3 border-b border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <div>Report</div>
            <div>Reported by</div>
            <div>When / page</div>
            <div>Status</div>
          </div>
          {visible.map((b) => (
            <button
              key={b.id}
              onClick={() => canEdit && setEditing(b)}
              className="grid w-full grid-cols-[1.8fr_0.9fr_1fr_0.9fr] gap-3 border-b border-edge/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-panel2/60"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-bold uppercase ${SEVERITY_STYLE[b.severity]}`}>●</span>
                  <span className="truncate font-medium text-gray-100">{b.title}</span>
                </div>
                <div className="truncate text-[11px] text-gray-500">{b.description}</div>
              </div>
              <div className="truncate text-[11px] text-gray-400">{b.reportedBy ?? "—"}</div>
              <div className="text-[11px] text-gray-500">
                <div>{timeAgo(b.createdAt)}</div>
                {b.page && <div className="truncate text-gray-600">{b.page}</div>}
              </div>
              <div>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[b.status]}`}>
                  {STATUS_LABEL[b.status]}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <FormModal
          title={`Edit report: ${editing.title}`}
          fields={FIELDS}
          initial={editing}
          onSave={save}
          onClose={() => setEditing(null)}
          onDelete={remove}
          deleteLabel="Delete report"
        />
      )}
    </PageShell>
  );
}
