"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "./PageShell";
import FormModal, { FieldDef } from "./FormModal";
import { useAuth } from "./AuthProvider";
import { apiFetch } from "@/lib/apiFetch";

export interface RegColumn<T> {
  label: string;
  render: (row: T) => React.ReactNode;
}

export interface RegisterConfig<T> {
  title: string;
  subtitle: string;
  addLabel: string;
  api: string; // e.g. /api/resources
  query?: string; // e.g. type=PERSONNEL
  sectionOf?: (row: T) => string;
  sectionOrder?: string[];
  columns: RegColumn<T>[];
  fields: FieldDef[];
  newDefaults: Record<string, any>;
  searchText: (row: T) => string;
  statusOf?: (row: T) => string; // enables the status filter
  statusOptions?: { value: string; label: string }[];
  header?: (rows: T[]) => React.ReactNode; // e.g. summary tiles
  tabs?: React.ReactNode;
  itemNoun?: string;
  detail?: (row: T) => React.ReactNode; // extra panel in the edit modal (existing rows only)
}

const PILL: Record<string, string> = {
  AVAILABLE: "bg-emerald-900/60 text-emerald-300",
  ON_SITE: "bg-blue-900/60 text-blue-300",
  DOWN: "bg-red-900/60 text-red-300",
  LEAVE: "bg-amber-900/60 text-amber-300",
};

export function StatusPill({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
        PILL[value] ?? "bg-gray-700 text-gray-300"
      }`}
    >
      {label ?? value}
    </span>
  );
}

export default function RegisterPage<T extends { id: string }>({
  config,
}: {
  config: RegisterConfig<T>;
}) {
  const { canEdit } = useAuth();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<T | "new" | null>(null);

  const url = config.query ? `${config.api}?${config.query}` : config.api;

  const load = useCallback(async () => {
    const res = await apiFetch(url);
    if (res.ok) setRows(await res.json());
    setLoading(false);
  }, [url]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!q || config.searchText(r).toLowerCase().includes(q)) &&
        (!status || !config.statusOf || config.statusOf(r) === status)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, status]);

  const sections = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const r of visible) {
      const s = config.sectionOf ? config.sectionOf(r) : "";
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(r);
    }
    const order = config.sectionOrder ?? [];
    return Array.from(map.entries()).sort(
      (a, b) =>
        (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) -
        (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function save(values: Record<string, any>) {
    const isNew = editing === "new";
    const res = await fetch(
      isNew ? config.api : `${config.api}/${(editing as T).id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Save failed");
    }
    await load();
  }

  async function remove() {
    const res = await fetch(`${config.api}/${(editing as T).id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete failed");
    await load();
  }

  const gridStyle = {
    gridTemplateColumns: `repeat(${config.columns.length}, minmax(0, 1fr))`,
  };

  return (
    <PageShell
      title={config.title}
      subtitle={config.subtitle}
      actions={
        canEdit ? (
          <button
            onClick={() => setEditing("new")}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            + {config.addLabel}
          </button>
        ) : undefined
      }
    >
      {config.tabs}
      {config.header?.(rows)}

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-64 rounded-md border border-edge bg-panel2 px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {config.statusOptions && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-edge bg-panel2 px-2 py-1.5 text-sm text-gray-200"
          >
            <option value="">All statuses</option>
            {config.statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : sections.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-600">
          Nothing here yet.
        </div>
      ) : (
        sections.map(([name, list]) => (
          <div key={name} className="mb-6">
            {name && (
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {name} <span className="text-gray-600">· {list.length}</span>
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-edge">
              <div
                style={gridStyle}
                className="grid gap-3 border-b border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500"
              >
                {config.columns.map((c) => (
                  <div key={c.label}>{c.label}</div>
                ))}
              </div>
              {list.map((row) => (
                <button
                  key={row.id}
                  onClick={() => canEdit && setEditing(row)}
                  style={gridStyle}
                  className="grid w-full gap-3 border-b border-edge/60 px-3 py-2 text-left text-sm text-gray-200 last:border-0 hover:bg-panel2/60"
                >
                  {config.columns.map((c) => (
                    <div key={c.label} className="min-w-0 truncate">
                      {c.render(row) ?? <span className="text-gray-600">—</span>}
                    </div>
                  ))}
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {editing && (
        <FormModal
          title={
            editing === "new"
              ? config.addLabel
              : `Edit ${config.itemNoun ?? "item"}`
          }
          fields={config.fields}
          initial={editing === "new" ? config.newDefaults : (editing as any)}
          onSave={save}
          onClose={() => setEditing(null)}
          onDelete={editing === "new" ? undefined : remove}
          extra={editing !== "new" && config.detail ? config.detail(editing as T) : undefined}
          wide={editing !== "new" && !!config.detail}
        />
      )}
    </PageShell>
  );
}
