"use client";

// The Bins page's "Tipper loads" tab (Ilies, 27 Nov 2026: "this allows the drivers to log waste collected in the tippers
// also"): loads logged from the drivers' links, with filters by job, tipper and date, client's / ours, the photos, the
// suggested tip docket (confirm / not this one), cancel / correct with a reason, client's loads by job, and the list of
// our tippers. Managers and Admins change things; the coordinator only looks - exactly as for bins. No money here.
import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";
import FormModal, { type FieldDef } from "@/components/FormModal";
import HistoryButton from "@/components/HistoryButton";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { TipDTO } from "@/lib/bins/store";
import type { TipperOfficeDTO, TipperOfficeRowDTO, TipperFleetDTO } from "@/lib/bins/tipperStore";

type Filters = { projectId?: string; vehicleId?: string; use?: string; from?: string; to?: string; status?: string };
const select = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200";
const btn = "rounded-md border border-edge px-2 py-1 text-xs text-gray-300 hover:bg-panel2 hover:text-white";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "-");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" }) : "-");

async function send(url: string, body: Record<string, unknown>) {
  const r = await apiFetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await serverErrorMessage(r, "Couldn't save."));
  return r.json();
}

type Modal = { kind: "correct" | "cancel"; row: TipperOfficeRowDTO } | { kind: "flag"; v: TipperFleetDTO };

export default function TipperLoadsTab({ canEdit, coordinatorOnly }: { canEdit: boolean; coordinatorOnly: boolean }) {
  const [f, setF] = useState<Filters>({});
  const [data, setData] = useState<TipperOfficeDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [showFleet, setShowFleet] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiFetch(`/api/bins/tipper-loads?${q}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the tipper loads."))));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value || undefined }));
  const done = (m: string) => { setFlash(m); setModal(null); load(); };
  const tip = async (row: TipperOfficeRowDTO, t: TipDTO, ok: boolean) => {
    try { await send(`/api/bins/tipper-loads/${row.id}`, { action: ok ? "tip-confirm" : "tip-reject", receiptId: t.receiptId }); done(ok ? "Tip docket matched to the load." : "Marked as not this load's docket."); }
    catch (e) { setFlash(null); setError((e as Error).message); }
  };
  const tippers = data?.fleet.filter((v) => v.tipper) ?? [];

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        Waste loaded into our tippers at a job, logged with a photo from the drivers&apos; links. Client&apos;s loads are charged to the client - charging is done elsewhere.
        {data && <> Our tippers: {tippers.length ? tippers.map((t) => t.name).join(", ") : "none"}.{" "}
          <button className="text-brand-300 hover:underline" onClick={() => setShowFleet((x) => !x)}>{showFleet ? "Hide" : coordinatorOnly ? "See the list" : "Change the list"}</button></>}
      </p>
      {showFleet && data && <Fleet data={data} canEdit={canEdit} onModal={setModal} />}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={select} value={f.projectId ?? ""} onChange={set("projectId")} aria-label="Job">
          <option value="">All jobs</option>{data?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select className={select} value={f.vehicleId ?? ""} onChange={set("vehicleId")} aria-label="Tipper">
          <option value="">All tippers</option>{data?.tippers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select className={select} value={f.use ?? ""} onChange={set("use")} aria-label="Client's or ours">
          <option value="">Client&apos;s and ours</option><option value="CLIENT">Client&apos;s loads</option><option value="OURS">Our loads</option>
        </select>
        <label className="text-xs text-gray-400">From <input type="date" className={select} value={f.from ?? data?.range.from ?? ""} onChange={set("from")} /></label>
        <label className="text-xs text-gray-400">To <input type="date" className={select} value={f.to ?? data?.range.to ?? ""} onChange={set("to")} /></label>
        <select className={select} value={f.status ?? ""} onChange={set("status")} aria-label="Status">
          <option value="">Logged and cancelled</option><option value="LOGGED">Logged</option><option value="CANCELLED">Cancelled</option>
        </select>
        {Object.values(f).some(Boolean) && <button className="text-xs text-brand-300 hover:underline" onClick={() => setF({})}>Clear</button>}
      </div>
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p> : (
        <div className="space-y-4">
          {data.clientByJob.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
              <p className="px-4 pt-3 text-xs text-gray-500">Client&apos;s tipper loads by job, {day(data.range.from)} to {day(data.range.to)}. Cancelled loads don&apos;t count.</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500"><tr><th className="px-4 py-2">Job</th><th className="px-2">Client</th><th className="px-2">Client&apos;s loads</th><th /></tr></thead>
                <tbody className="divide-y divide-edge/60">
                  {data.clientByJob.map((c) => (
                    <tr key={c.projectId}>
                      <td className="px-4 py-2 text-gray-100">{c.project}{c.jobNo ? <span className="text-xs text-gray-500"> ({c.jobNo})</span> : null}</td>
                      <td className="px-2 text-gray-400">{c.client ?? "-"}</td>
                      <td className="px-2 font-semibold text-amber-200">{c.loads}</td>
                      <td className="px-2 text-right"><button className={btn} onClick={() => setF((x) => ({ from: x.from, to: x.to, projectId: c.projectId, use: "CLIENT" }))}>See them</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.loads.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">No tipper loads in that range.</p> : (
            <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">{data.loads.map((r) => <LoadRow key={r.id} r={r} canEdit={canEdit} onModal={setModal} onTip={tip} />)}</ul>
          )}
        </div>
      )}
      {modal && data && <Modals modal={modal} data={data} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

function Fleet({ data, canEdit, onModal }: { data: TipperOfficeDTO; canEdit: boolean; onModal: (m: Modal) => void }) {
  return (
    <div className="mb-3 rounded-xl border border-edge bg-panel">
      <p className="px-4 pt-3 text-xs text-gray-500">Our own vehicles in use. A vehicle is a tipper when its name says &quot;Tipper&quot;, unless a Manager or Admin has set it here. Only tippers show on the drivers&apos; links.</p>
      <ul className="divide-y divide-edge/60">
        {data.fleet.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <Truck size={16} className="text-gray-500" />
            <span className="text-sm text-gray-100">{v.name}</span>
            <span className={`text-xs ${v.tipper ? "text-emerald-300" : "text-gray-500"}`}>{v.tipper ? "Tipper" : "Not a tipper"}{v.set ? " (set by the office)" : " (from its name)"}</span>
            {canEdit && (
              <span className="ml-auto flex gap-2">
                <button className={btn} onClick={() => onModal({ kind: "flag", v })}>{v.tipper ? "Not a tipper" : "Make it a tipper"}</button>
                <HistoryButton model="Resource" id={v.id} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TipLine({ t }: { t: TipDTO }) {
  return (
    <span>
      Docket {t.docketNo ?? "(no number yet)"} · {t.docketAt ? when(t.docketAt) : `sent ${when(t.sentAt)}`} by {t.sentBy}
      {t.tipSite ? ` · ${t.tipSite}` : ""}{t.wasteType ? ` · ${t.wasteType}` : ""}{t.tonnes != null ? ` · ${t.tonnes} t` : ""}
    </span>
  );
}

function LoadRow({ r, canEdit, onModal, onTip }: { r: TipperOfficeRowDTO; canEdit: boolean; onModal: (m: Modal) => void; onTip: (r: TipperOfficeRowDTO, t: TipDTO, ok: boolean) => void }) {
  const cancelled = r.statusKey === "CANCELLED";
  return (
    <li className={`px-4 py-3 ${cancelled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-gray-100">{r.tipper}</span>
        {r.useKey === "CLIENT"
          ? <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200" title="Charged to the client - a variation">Client&apos;s load</span>
          : <span className="rounded-full bg-panel2 px-2 py-0.5 text-xs text-gray-300">Our load</span>}
        <span className="text-sm text-gray-300">{r.contents}{r.contentsKey !== "OTHER" && r.contentsNote ? ` (${r.contentsNote})` : ""}</span>
        <span className="text-sm text-gray-400">· {r.project}{r.jobNo ? ` (${r.jobNo})` : ""}</span>
        {cancelled && <span className="ml-auto text-xs text-gray-400">Cancelled</span>}
      </div>
      <div className="mt-0.5 text-xs text-gray-500">
        Loaded {when(r.loadedAt)} by {r.loadedBy}{r.fromSignIn ? " (tipper from their truck sign-in)" : ""}
        {r.cancelled && <> · cancelled by {r.cancelled.by}: {r.cancelled.reason}</>}
      </div>
      {r.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.photos.map((p) => (
            <a key={p.id} href={`/api/bins/tipper-loads/photos/${p.id}`} target="_blank" rel="noreferrer" className="block" title="The load">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/bins/tipper-loads/photos/${p.id}`} alt="The load" className="h-20 w-20 rounded-md border border-edge object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {!cancelled && (
        <div className="mt-2 rounded-lg bg-panel2/60 px-3 py-2 text-xs text-gray-300">
          {r.tip ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-emerald-300">Tip docket ✓</span><TipLine t={r.tip} />
              {canEdit && <button className={btn} onClick={() => onTip(r, r.tip!, false)}>Not this one</button>}
            </div>
          ) : r.suggestions.length ? (
            <div className="space-y-1">
              <div className="text-gray-400">Tip docket - is it one of these? (same job, within about 2 days)</div>
              {r.suggestions.map((t) => (
                <div key={t.receiptId} className="flex flex-wrap items-center gap-2">
                  <TipLine t={t} />{t.sameDriver && <span className="rounded bg-brand-600/30 px-1.5 text-[10px] text-brand-100">same driver</span>}
                  {canEdit && (<>
                    <button className={btn} onClick={() => onTip(r, t, true)}>Confirm</button>
                    <button className={btn} onClick={() => onTip(r, t, false)}>Not this one</button>
                  </>)}
                </div>
              ))}
            </div>
          ) : <span className="text-gray-500">No tip docket yet for this job around the load.</span>}
        </div>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!cancelled && <button className={btn} onClick={() => onModal({ kind: "correct", row: r })}>Correct</button>}
          {!cancelled && <button className={btn} onClick={() => onModal({ kind: "cancel", row: r })}>Cancel entry</button>}
          <HistoryButton model="TipperLoad" id={r.id} />
        </div>
      )}
    </li>
  );
}

function Modals({ modal, data, onClose, onDone }: { modal: Modal; data: TipperOfficeDTO; onClose: () => void; onDone: (m: string) => void }) {
  const reason: FieldDef = { key: "reason", label: "Why", type: "textarea", required: true, full: true };
  if (modal.kind === "flag") {
    const v = modal.v;
    return (
      <FormModal title={v.tipper ? `${v.name} is not a tipper` : `Make ${v.name} a tipper`} submitLabel="Save" onClose={onClose}
        fields={[{ key: "reason", label: "Why (optional)", full: true }]} initial={{ reason: "" }}
        onSave={async (x) => { await send(`/api/bins/tippers/${v.id}`, { tipper: !v.tipper, reason: x.reason }); onDone(v.tipper ? `${v.name} is off the tipper list.` : `${v.name} is on the tipper list.`); }} />
    );
  }
  const r = modal.row;
  if (modal.kind === "cancel") {
    return (
      <FormModal title={`Cancel this load (${r.tipper}, ${r.project})`} submitLabel="Cancel entry" onClose={onClose} fields={[reason]} initial={{ reason: "" }}
        onSave={async (v) => { await send(`/api/bins/tipper-loads/${r.id}`, { action: "cancel", reason: v.reason }); onDone("Load cancelled - it's kept, marked cancelled."); }} />
    );
  }
  const tipperChoices = data.fleet.filter((v) => v.tipper).map((v) => ({ value: v.id, label: v.name }));
  if (!tipperChoices.some((t) => t.value === r.vehicleId)) tipperChoices.unshift({ value: r.vehicleId, label: r.tipper });
  const projectChoices = data.pickProjects.some((p) => p.id === r.projectId) ? data.pickProjects : [{ id: r.projectId, label: r.project }, ...data.pickProjects];
  const initial = { vehicleId: r.vehicleId, projectId: r.projectId, use: r.useKey, contents: r.contentsKey, contentsNote: r.contentsNote ?? "", reason: "" };
  return (
    <FormModal title={`Correct ${r.tipper} load at ${r.project}`} onClose={onClose}
      fields={[
        { key: "vehicleId", label: "Tipper", type: "select", options: tipperChoices },
        { key: "projectId", label: "Job", type: "select", options: projectChoices.map((p) => ({ value: p.id, label: p.label })), full: true },
        { key: "use", label: "Client's or ours", type: "select", options: data.uses.map((u) => ({ value: u.key, label: u.label })) },
        { key: "contents", label: "What's in it", type: "select", options: data.contents.map((c) => ({ value: c.key, label: c.label })) },
        { key: "contentsNote", label: "Note", full: true },
        reason,
      ]}
      initial={initial}
      onSave={async (v) => {
        const changed: Record<string, unknown> = {};
        for (const k of ["vehicleId", "projectId", "use", "contents", "contentsNote"] as const) if ((v[k] ?? "") !== (initial[k] ?? "")) changed[k] = v[k] === "" ? null : v[k];
        if (!Object.keys(changed).length) throw new Error("Nothing to change.");
        await send(`/api/bins/tipper-loads/${r.id}`, { action: "correct", ...changed, reason: v.reason });
        onDone("Corrected - the change is in its History.");
      }} />
  );
}
