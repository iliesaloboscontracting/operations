"use client";

import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import FormModal, { FieldDef } from "@/components/FormModal";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/owner";
import { apiFetch } from "@/lib/apiFetch";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "VIEWER" | "TIMESHEETS" | "ACCOUNTS" | "DIRECTOR";
  active: boolean;
  directorAccess: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin — manage users + edit everything" },
  { value: "MANAGER", label: "Manager — edit board, calendar, registers" },
  { value: "VIEWER", label: "Viewer — read only" },
  { value: "TIMESHEETS", label: "Timesheets — review only, nothing else" },
  { value: "ACCOUNTS", label: "Accounts — upload invoices, nothing else" },
];
// Directors-only login (25 Oct 2026) - only the owner can give or take it away.
const DIRECTOR_OPTION = { value: "DIRECTOR", label: "Director — company overview only, no Operations" };

const ROLE_STYLE: Record<string, string> = {
  ADMIN: "bg-purple-900/60 text-purple-300",
  MANAGER: "bg-blue-900/60 text-blue-300",
  VIEWER: "bg-gray-700 text-gray-300",
  TIMESHEETS: "bg-emerald-900/50 text-emerald-300",
  ACCOUNTS: "bg-amber-900/50 text-amber-300",
  DIRECTOR: "bg-sky-900/50 text-sky-300",
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never";
}

export default function UsersPage() {
  const { isAdmin, loading, user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/users");
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (loading) return null;
  if (!isAdmin) {
    return (
      <PageShell title="Users" subtitle="Manage who can sign in.">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">
          Only admins can manage users.
        </div>
      </PageShell>
    );
  }

  const isNew = editing === "new";
  // Director access: only the owner hands it out, and the owner always has it.
  const canSetDirector = isOwner(me?.email) && !isNew && !isOwner((editing as UserRow | null)?.email);
  const fields: FieldDef[] = [
    { key: "name", label: "Name", required: true, full: !isNew },
    ...(isNew ? ([{ key: "email", label: "Email", required: true }] as FieldDef[]) : []),
    {
      key: "role",
      label: "Role",
      type: "select",
      // The owner can pick Director; anyone else only sees it on someone who already has it (and can't change it).
      options: isOwner(me?.email) || (editing as UserRow | null)?.role === "DIRECTOR" ? [...ROLE_OPTIONS, DIRECTOR_OPTION] : ROLE_OPTIONS,
      full: true,
    },
    ...(!isNew
      ? ([
          {
            key: "active",
            label: "Account",
            type: "select",
            options: [
              { value: "yes", label: "Active" },
              { value: "no", label: "Deactivated (cannot sign in)" },
            ],
          },
        ] as FieldDef[])
      : []),
    ...(canSetDirector
      ? ([
          {
            key: "directorAccess",
            label: "Directors overview",
            type: "select",
            options: [
              { value: "no", label: "No access" },
              { value: "yes", label: "Yes - sees company costs and contract values" },
            ],
            full: true,
          },
        ] as FieldDef[])
      : []),
    {
      key: "password",
      label: isNew ? "Password (8+ characters)" : "Reset password (leave blank to keep)",
      type: "password",
      required: isNew,
      full: true,
    },
  ];

  async function save(v: Record<string, any>) {
    const body: Record<string, unknown> = { name: v.name, role: v.role };
    if (v.password) body.password = v.password;
    let res: Response;
    if (isNew) {
      res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, email: v.email }),
      });
    } else {
      body.active = v.active !== "no";
      if (canSetDirector) body.directorAccess = v.directorAccess === "yes";
      res = await fetch(`/api/users/${(editing as UserRow).id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Save failed");
    await load();
  }

  return (
    <PageShell
      title="Users"
      subtitle="Who can sign in, and what they can do."
      actions={
        <button
          onClick={() => setEditing("new")}
          className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
        >
          + Add user
        </button>
      }
    >
      <div className="overflow-hidden rounded-lg border border-edge">
        <div className="grid grid-cols-[1.2fr_1.6fr_0.7fr_0.9fr_0.7fr] gap-3 border-b border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <div>Name</div>
          <div>Email</div>
          <div>Role</div>
          <div>Last sign-in</div>
          <div>Status</div>
        </div>
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => setEditing(u)}
            disabled={isOwner(u.email) && !isOwner(me?.email)}
            title={isOwner(u.email) && !isOwner(me?.email) ? "Only Iliesa can change this account" : undefined}
            className={`grid w-full grid-cols-[1.2fr_1.6fr_0.7fr_0.9fr_0.7fr] gap-3 border-b border-edge/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-panel2/60 ${
              u.active ? "text-gray-200" : "text-gray-500"
            }`}
          >
            <div className="flex min-w-0 items-center font-medium">
              <span className="truncate">{u.name}</span>
              {u.id === me?.id && <span className="ml-1 shrink-0 text-[10px] text-gray-500">(you)</span>}
              {isOwner(u.email) && <span className="ml-1.5 shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-300">Owner</span>}
              {u.directorAccess && !isOwner(u.email) && <span className="ml-1.5 shrink-0 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-sky-300">Director</span>}
            </div>
            <div className="truncate">{u.email}</div>
            <div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ROLE_STYLE[u.role]}`}>{u.role}</span>
            </div>
            <div className="text-gray-500">{when(u.lastLoginAt)}</div>
            <div>{u.active ? "Active" : "Deactivated"}</div>
          </button>
        ))}
      </div>

      {editing && (
        <FormModal
          title={isNew ? "Add user" : `Edit ${(editing as UserRow).email}`}
          fields={fields}
          initial={
            isNew
              ? { role: "VIEWER" }
              : {
                  ...(editing as UserRow),
                  active: (editing as UserRow).active ? "yes" : "no",
                  directorAccess: (editing as UserRow).directorAccess ? "yes" : "no",
                  password: "",
                }
          }
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </PageShell>
  );
}
