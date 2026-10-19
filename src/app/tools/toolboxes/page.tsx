"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, ScanLine } from "lucide-react";
import PageShell from "@/components/PageShell";
import ToolsTabs from "@/components/tools/ToolsTabs";
import PhotoPicker from "@/components/tools/PhotoPicker";
import CheckResultView from "@/components/tools/CheckResultView";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { CheckResult } from "@/lib/toolboxCheck";
import type { ResourceDTO, ToolboxDTO, ToolDTO } from "@/lib/types";

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

const json = (url: string, method: string, body: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function ToolboxesPage() {
  const { canEdit } = useAuth();
  const [boxes, setBoxes] = useState<ToolboxDTO[]>([]);
  const [tools, setTools] = useState<ToolDTO[]>([]);
  const [people, setPeople] = useState<ResourceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState<ToolboxDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([apiFetch("/api/toolboxes"), apiFetch("/api/tools")]);
    if (b.ok) setBoxes(await b.json());
    if (t.ok) setTools(await t.json());
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    apiFetch("/api/resources?type=PERSONNEL").then((r) => (r.ok ? r.json() : [])).then(setPeople);
  }, [load]);

  async function act(fn: () => Promise<Response>, fallback: string) {
    setError(null);
    const res = await fn();
    if (!res.ok) {
      setError(await serverErrorMessage(res, fallback));
      return false;
    }
    await load();
    return true;
  }

  const unassigned = tools.filter((t) => !t.toolboxId && t.condition !== "Swapped out");

  return (
    <PageShell
      title="Toolboxes"
      subtitle="Each supervisor's toolbox and the exact tools (by serial / LOB tag) that should be in it."
      actions={
        canEdit ? (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500">
            <Plus size={16} /> New toolbox
          </button>
        ) : undefined
      }
    >
      <ToolsTabs />
      {error && <div className="mb-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : boxes.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500">No toolboxes yet. Create one for each supervisor, then add their tools.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {boxes.map((b) => (
            <ToolboxCard
              key={b.id}
              box={b}
              canEdit={canEdit}
              people={people}
              unassigned={unassigned}
              onCheck={() => setChecking(b)}
              act={act}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewToolbox
          people={people}
          onClose={() => setCreating(false)}
          onSave={async (name, supervisorId) => {
            if (await act(() => json("/api/toolboxes", "POST", { name, supervisorId }), "Couldn't create the toolbox.")) setCreating(false);
          }}
        />
      )}
      {checking && <CheckToolbox box={checking} onClose={() => setChecking(null)} onChanged={load} />}
    </PageShell>
  );
}

function ToolboxCard({
  box, canEdit, people, unassigned, onCheck, act,
}: {
  box: ToolboxDTO;
  canEdit: boolean;
  people: ResourceDTO[];
  unassigned: ToolDTO[];
  onCheck: () => void;
  act: (fn: () => Promise<Response>, fallback: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState("");
  const last = box.lastCheck;
  return (
    <div className="min-w-0 rounded-xl border border-edge bg-panel p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-gray-100">{box.name}</div>
          {canEdit ? (
            <select
              className="mt-1 rounded border border-edge bg-panel2 px-2 py-0.5 text-xs text-gray-300"
              value={box.supervisorId ?? ""}
              onChange={(e) => act(() => json(`/api/toolboxes/${box.id}`, "PATCH", { supervisorId: e.target.value || null }), "Couldn't change the supervisor.")}
            >
              <option value="">No supervisor set</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <div className="text-xs text-gray-400">{box.supervisor?.name ?? "No supervisor set"}</div>
          )}
        </div>
        {canEdit && (
          <button onClick={onCheck} className="flex items-center gap-1.5 rounded-lg border border-brand-500 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-600/20">
            <ScanLine size={14} /> Check by photo
          </button>
        )}
      </div>

      <div className="mb-2 text-[11px] text-gray-500">
        {box.tools.length} tool{box.tools.length === 1 ? "" : "s"} ·{" "}
        {last
          ? `last checked ${new Date(last.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}${last.checkedBy ? ` by ${last.checkedBy}` : ""}${
              last.missing || last.foreign ? ` — ${last.missing ?? 0} missing, ${last.foreign ?? 0} from other boxes` : " — all good"
            }`
          : "never checked"}
      </div>

      <ul className="divide-y divide-edge/60 rounded-lg border border-edge">
        {box.tools.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">Empty — add tools below.</li>}
        {box.tools.map((t) => (
          <li key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="w-20 shrink-0 font-mono text-gray-400">{t.tag}</span>
            <span className="min-w-0 flex-1 truncate text-gray-200">
              {t.name}
              {(t.brand || t.model) && <span className="text-gray-500"> · {[t.brand, t.model].filter(Boolean).join(" ")}</span>}
            </span>
            <span className="hidden shrink-0 font-mono text-gray-500 sm:inline">{t.serialNumber ?? "no serial"}</span>
            {t.condition !== "Good" && t.condition !== "New" && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-500">{t.condition}</span>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div className="mt-3 flex min-w-0 gap-2">
          <select className={`${input} min-w-0 py-1.5 text-xs`} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a tool from the yard…</option>
            {unassigned.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tag} · {t.name}{t.serialNumber ? ` · ${t.serialNumber}` : ""}
              </option>
            ))}
          </select>
          <button
            className={btn}
            disabled={!adding}
            onClick={async () => {
              if (await act(() => json(`/api/tools/${adding}`, "PATCH", { toolboxId: box.id, moveReason: "Added to toolbox" }), "Couldn't add the tool.")) setAdding("");
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function NewToolbox({ people, onClose, onSave }: { people: ResourceDTO[]; onClose: () => void; onSave: (name: string, supervisorId: string | null) => Promise<void> }) {
  const [name, setName] = useState("");
  const [sup, setSup] = useState("");
  return (
    <Modal title="New toolbox" onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-400">Supervisor</span>
          <select
            className={input}
            value={sup}
            onChange={(e) => {
              setSup(e.target.value);
              const p = people.find((x) => x.id === e.target.value);
              if (p && !name) setName(`${p.name}'s toolbox`);
            }}
          >
            <option value="">Not set yet</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-400">Toolbox name</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sinan's toolbox" />
        </label>
        <div className="flex justify-end">
          <button className={btn} disabled={!name.trim()} onClick={() => onSave(name.trim(), sup || null)}>Create</button>
        </div>
      </div>
    </Modal>
  );
}

// Photo check of one toolbox: up to 4 photos -> what's here, what's missing,
// and what belongs in another toolbox. Nothing changes unless a button is pressed.
function CheckToolbox({ box, onClose, onChanged }: { box: ToolboxDTO; onClose: () => void; onChanged: () => Promise<void> }) {
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await json(`/api/toolboxes/${box.id}/check`, "POST", { photoIds: photos.filter(Boolean) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't check the toolbox."));
      setResult((await res.json()).result);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(toolId: string, body: unknown, label: string) {
    setError(null);
    const res = await json(`/api/tools/${toolId}`, "PATCH", body);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't update the tool."));
    setDone((d) => ({ ...d, [toolId]: label }));
    await onChanged();
  }


  return (
    <Modal title={`Check ${box.name}`} onClose={onClose} wide>
      {!result ? (
        <>
          <p className="mb-3 text-xs text-gray-400">
            Lay the tools out so their LOB labels (or rating plates) face the camera, then take 1–4 photos.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {photos.map((p, i) => (
              <PhotoPicker
                key={i}
                kind="CHECK"
                label={`Photo ${i + 1}`}
                photoId={p}
                onChange={(id) => setPhotos((ps) => ps.map((x, j) => (j === i ? id : x)))}
              />
            ))}
          </div>
          {error && <div className="mt-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="mt-4 flex justify-between">
            <button className={quiet} disabled={photos.length >= 4} onClick={() => setPhotos((ps) => [...ps, null])}>+ Another photo</button>
            <button className={`${btn} flex items-center gap-1.5`} disabled={busy || !photos.some(Boolean)} onClick={run}>
              {busy && <Loader2 size={13} className="animate-spin" />} {busy ? "Checking…" : "Check toolbox"}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
          <CheckResultView
            result={result}
            boxName={box.name}
            done={done}
            onSendBack={(toolId, belongsTo) => setDone((d) => ({ ...d, [toolId]: `Leave it - return it to ${belongsTo ?? "the yard"}` }))}
            onMine={(toolId) => act(toolId, { toolboxId: box.id, moveReason: `Found in ${box.name} on a photo check` }, `Now belongs in ${box.name}`)}
            onMissing={(toolId) => act(toolId, { condition: "Missing" }, "Marked missing")}
          />
          <div className="flex justify-end">
            <button className={btn} onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`animate-modal-in max-h-full w-full overflow-y-auto rounded-2xl border border-edge bg-panel p-5 shadow-soft-lg ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} className="-mr-1 -mt-1 rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
