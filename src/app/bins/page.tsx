"use client";

// Bins (Ilies, 23 Nov 2026): bins delivered to and picked up from jobs, photographed from the supervisors' and drivers'
// links. Out now (by job), the picked-up history with filters, client's bins by job (Alex tracks them as variations),
// and the register of Lobos's own bins. Managers and Admins correct, cancel, confirm tip dockets and keep the register;
// the coordinator only looks. Nothing is deleted - every change is in the record's History with its reason.
// No money here: charging the client is done elsewhere.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Container } from "lucide-react";
import PageShell from "@/components/PageShell";
import FormModal, { type FieldDef } from "@/components/FormModal";
import HistoryButton from "@/components/HistoryButton";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { BinOfficeRowDTO, BinRegisterDTO, BinsOfficeDTO, TipDTO } from "@/lib/bins/store";

type Tab = "out" | "history" | "client" | "register";
type Filters = { projectId?: string; use?: string; from?: string; to?: string; status?: string };
const select = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200";
const btn = "rounded-md border border-edge px-2 py-1 text-xs text-gray-300 hover:bg-panel2 hover:text-white";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "-");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" }) : "-");
const days = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`);

async function send(url: string, body: Record<string, unknown>, method = "PATCH") {
  const r = await apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await serverErrorMessage(r, "Couldn't save."));
  return r.json();
}

type Modal =
  | { kind: "correct"; row: BinOfficeRowDTO }
  | { kind: "cancel" | "unpick"; row: BinOfficeRowDTO }
  | { kind: "add" }
  | { kind: "rename" | "retire"; bin: BinRegisterDTO };

export default function BinsPage() {
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("out");
  const [f, setF] = useState<Filters>({});
  const [data, setData] = useState<BinsOfficeDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiFetch(`/api/bins?${q}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the bins."))));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <PageShell title="Bins"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit && !coordinatorOnly) return <PageShell title="Bins"><p className="text-sm text-gray-500">Managers, Admins and the project coordinator only.</p></PageShell>;
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value || undefined }));
  const done = (m: string) => { setFlash(m); setModal(null); load(); };
  const tabBtn = (on: boolean) => `rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide ${on ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"}`;
  const tip = async (row: BinOfficeRowDTO, t: TipDTO, ok: boolean) => {
    try { await send(`/api/bins/${row.id}`, { action: ok ? "tip-confirm" : "tip-reject", receiptId: t.receiptId }); done(ok ? "Tip docket matched to the bin." : "Marked as not this bin's docket."); }
    catch (e) { setFlash(null); setError((e as Error).message); }
  };

  const outByJob = data ? [...new Set(data.out.map((r) => r.projectId))].map((pid) => ({ pid, rows: data.out.filter((r) => r.projectId === pid) })) : [];
  return (
    <PageShell
      title="Bins"
      subtitle={coordinatorOnly ? "Bins delivered to and picked up from jobs, with the photos from site. Client's bins are charged to the client. View only." : "Bins delivered to and picked up from jobs, photographed from the supervisors' and drivers' links. Client's bins are charged to the client - charging is done elsewhere."}
    >
      {data && data.warnings.length > 0 && (
        <div className="mb-3 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {data.warnings.map((w) => <p key={w.size} className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{w.text}</p>)}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-1">
        <button className={tabBtn(tab === "out")} onClick={() => setTab("out")}>Out now{data ? ` (${data.out.length})` : ""}</button>
        <button className={tabBtn(tab === "history")} onClick={() => setTab("history")}>Picked up</button>
        <button className={tabBtn(tab === "client")} onClick={() => setTab("client")}>Client&apos;s bins by job</button>
        <button className={tabBtn(tab === "register")} onClick={() => setTab("register")}>Register</button>
      </div>
      {(tab === "out" || tab === "history" || tab === "client") && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className={select} value={f.projectId ?? ""} onChange={set("projectId")} aria-label="Job">
            <option value="">All jobs</option>{data?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {tab !== "client" && (
            <select className={select} value={f.use ?? ""} onChange={set("use")} aria-label="Client's or ours">
              <option value="">Client&apos;s and ours</option><option value="CLIENT">Client&apos;s bins</option><option value="OURS">Our bins</option>
            </select>
          )}
          {tab !== "out" && (<>
            <label className="text-xs text-gray-400">{tab === "client" ? "Delivered from" : "From"} <input type="date" className={select} value={f.from ?? data?.range.from ?? ""} onChange={set("from")} /></label>
            <label className="text-xs text-gray-400">To <input type="date" className={select} value={f.to ?? data?.range.to ?? ""} onChange={set("to")} /></label>
          </>)}
          {tab === "history" && (<>
            <select className={select} value={f.status ?? ""} onChange={set("status")} aria-label="Status">
              <option value="">Picked up and cancelled</option><option value="PICKED_UP">Picked up</option><option value="CANCELLED">Cancelled</option>
            </select>
          </>)}
          {Object.values(f).some(Boolean) && <button className="text-xs text-brand-300 hover:underline" onClick={() => setF({})}>Clear</button>}
        </div>
      )}
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p> : tab === "out" ? (
        outByJob.length === 0 ? <Empty text="No bins on site." /> : (
          <div className="space-y-4">
            {outByJob.map((g) => (
              <section key={g.pid} className="rounded-xl border border-edge bg-panel">
                <header className="flex flex-wrap items-baseline gap-2 border-b border-edge/60 px-4 py-2">
                  <span className="font-semibold text-gray-100">{g.rows[0].project}</span>
                  {g.rows[0].jobNo && <span className="text-xs text-gray-500">{g.rows[0].jobNo}</span>}
                  {g.rows[0].client && <span className="text-xs text-gray-500">· {g.rows[0].client}</span>}
                  <span className="ml-auto text-xs text-gray-400">{g.rows.length} out</span>
                </header>
                <ul className="divide-y divide-edge/60">{g.rows.map((r) => <MoveRow key={r.id} r={r} canEdit={canEdit} onModal={setModal} onTip={tip} />)}</ul>
              </section>
            ))}
          </div>
        )
      ) : tab === "history" ? (
        data.history.length === 0 ? <Empty text="Nothing picked up in that range." /> : (
          <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">{data.history.map((r) => <MoveRow key={r.id} r={r} canEdit={canEdit} onModal={setModal} onTip={tip} showJob />)}</ul>
        )
      ) : tab === "client" ? (
        <ClientByJob data={data} onOpen={(pid) => { setF((x) => ({ from: x.from, to: x.to, projectId: pid, use: "CLIENT" })); setTab("history"); }} />
      ) : (
        <Register data={data} canEdit={canEdit} onModal={setModal} onChanged={done} />
      )}
      {modal && data && <Modals modal={modal} data={data} onClose={() => setModal(null)} onDone={done} />}
    </PageShell>
  );
}

const Empty = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">{text}</p>;

function UseBadge({ r }: { r: BinOfficeRowDTO }) {
  return r.useKey === "CLIENT"
    ? <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200" title="Charged to the client - a variation">Client&apos;s bin</span>
    : <span className="rounded-full bg-panel2 px-2 py-0.5 text-xs text-gray-300">Our bin</span>;
}

function Photos({ r }: { r: BinOfficeRowDTO }) {
  if (!r.photos.length) return null;
  const label = (s: string | null) => (s === "DELIVERED" ? "Delivered" : s === "PICKED_UP" ? "Picked up" : "Earlier pick-up (undone)");
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {r.photos.map((p) => (
        <a key={p.id} href={`/api/bins/photos/${p.id}`} target="_blank" rel="noreferrer" className="block" title={label(p.stage)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/bins/photos/${p.id}`} alt={label(p.stage)} className="h-20 w-20 rounded-md border border-edge object-cover" loading="lazy" />
          <span className="block text-center text-[10px] text-gray-500">{label(p.stage)}</span>
        </a>
      ))}
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

function MoveRow({ r, canEdit, onModal, onTip, showJob }: { r: BinOfficeRowDTO; canEdit: boolean; onModal: (m: Modal) => void; onTip: (r: BinOfficeRowDTO, t: TipDTO, ok: boolean) => void; showJob?: boolean }) {
  return (
    <li className={`px-4 py-3 ${r.statusKey === "CANCELLED" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-gray-100">{r.bin}</span>
        {!r.bin.startsWith(r.size) && <span className="text-xs text-gray-500">{r.size}</span>}
        <UseBadge r={r} />
        <span className="text-sm text-gray-300">{r.contents}</span>
        {showJob && <span className="text-sm text-gray-400">· {r.project}{r.jobNo ? ` (${r.jobNo})` : ""}</span>}
        <span className="ml-auto text-xs text-gray-400">{r.statusKey === "ON_SITE" ? `out ${days(r.days)}` : r.statusKey === "PICKED_UP" ? `${days(r.days)} on site` : "Cancelled"}</span>
      </div>
      <div className="mt-0.5 text-xs text-gray-500">
        Delivered {when(r.deliveredAt)} by {r.deliveredBy}
        {r.pickedUpAt && <> · picked up {when(r.pickedUpAt)} by {r.pickedUpBy}</>}
        {r.cancelled && <> · cancelled by {r.cancelled.by}: {r.cancelled.reason}</>}
      </div>
      <Photos r={r} />
      {r.statusKey === "PICKED_UP" && (
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
          ) : <span className="text-gray-500">No tip docket yet for this job around the pick-up.</span>}
        </div>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {r.statusKey !== "CANCELLED" && <button className={btn} onClick={() => onModal({ kind: "correct", row: r })}>Correct</button>}
          {r.statusKey === "PICKED_UP" && <button className={btn} onClick={() => onModal({ kind: "unpick", row: r })}>Put back on site</button>}
          {r.statusKey !== "CANCELLED" && <button className={btn} onClick={() => onModal({ kind: "cancel", row: r })}>Cancel entry</button>}
          <HistoryButton model="BinMovement" id={r.id} />
        </div>
      )}
    </li>
  );
}

function ClientByJob({ data, onOpen }: { data: BinsOfficeDTO; onOpen: (projectId: string) => void }) {
  if (!data.clientByJob.length) return <Empty text="No client's bins delivered in that range." />;
  const total = data.clientByJob.reduce((n, c) => n + c.delivered, 0);
  return (
    <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
      <p className="px-4 pt-3 text-xs text-gray-500">Client&apos;s bins are charged per bin. Bins delivered from {day(data.range.from)} to {day(data.range.to)}: {total} - of each job&apos;s, how many are on site now and how many have been picked up. Cancelled entries don&apos;t count.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500"><tr><th className="px-4 py-2">Job</th><th className="px-2">Client</th><th className="px-2">Client&apos;s bins delivered</th><th className="px-2">On site now</th><th className="px-2">Picked up</th><th /></tr></thead>
        <tbody className="divide-y divide-edge/60">
          {data.clientByJob.map((c) => (
            <tr key={c.projectId}>
              <td className="px-4 py-2 text-gray-100">{c.project}{c.jobNo ? <span className="text-xs text-gray-500"> ({c.jobNo})</span> : null}</td>
              <td className="px-2 text-gray-400">{c.client ?? "-"}</td>
              <td className="px-2 font-semibold text-amber-200">{c.delivered}</td>
              <td className="px-2 text-gray-300">{c.onSite}</td>
              <td className="px-2 text-gray-300">{c.pickedUp}</td>
              <td className="px-2 text-right"><button className={btn} onClick={() => onOpen(c.projectId)}>See them</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Register({ data, canEdit, onModal, onChanged }: { data: BinsOfficeDTO; canEdit: boolean; onModal: (m: Modal) => void; onChanged: (m: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const restore = async (b: BinRegisterDTO) => {
    try { await send(`/api/bins/register/${b.id}`, { action: "restore" }); onChanged(`${b.label} is back in the register.`); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div>
      {canEdit && <button className="mb-3 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => onModal({ kind: "add" })}>+ Add a bin</button>}
      {err && <p className="mb-2 text-sm text-red-400">{err}</p>}
      {data.register.length === 0 ? <Empty text="No bins in the register yet." /> : (
        <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
          {data.register.map((b) => (
            <li key={b.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${b.retired ? "opacity-60" : ""}`}>
              <Container size={16} className="text-gray-500" />
              <span className="font-semibold text-gray-100">{b.label}</span>
              {!b.label.startsWith(b.size) && <span className="text-xs text-gray-500">{b.size}</span>}
              <span className="text-xs text-gray-400">{b.retired ? `Retired${b.retireReason ? ` - ${b.retireReason}` : ""}` : b.onSite ? `On site: ${b.onSite}` : "In the yard"}</span>
              {canEdit && (
                <span className="ml-auto flex gap-2">
                  {!b.retired && <button className={btn} onClick={() => onModal({ kind: "rename", bin: b })}>Rename</button>}
                  {!b.retired && <button className={btn} onClick={() => onModal({ kind: "retire", bin: b })}>Retire</button>}
                  {b.retired && <button className={btn} onClick={() => restore(b)}>Bring back</button>}
                  <HistoryButton model="Bin" id={b.id} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-500">Owned per size: {data.sizes.map((s) => `${s.label} ${data.register.filter((b) => !b.retired && b.sizeKey === s.key).length}`).join(" · ")}</p>
    </div>
  );
}

function Modals({ modal, data, onClose, onDone }: { modal: Modal; data: BinsOfficeDTO; onClose: () => void; onDone: (m: string) => void }) {
  const reason: FieldDef = { key: "reason", label: "Why", type: "textarea", required: true, full: true };
  if (modal.kind === "add") {
    return (
      <FormModal title="Add a bin" onClose={onClose}
        fields={[
          { key: "size", label: "Size", type: "select", required: true, options: data.sizes.map((s) => ({ value: s.key, label: s.label })) },
          { key: "label", label: "Name (blank = e.g. \"15 m³ (3)\")", placeholder: "Optional" },
        ]}
        initial={{ size: "", label: "" }}
        onSave={async (v) => { const r = await send("/api/bins/register", v, "POST"); onDone(`${r.label} added to the register.`); }} />
    );
  }
  if (modal.kind === "rename" || modal.kind === "retire") {
    const b = modal.bin;
    return modal.kind === "rename" ? (
      <FormModal title={`Rename ${b.label}`} onClose={onClose} fields={[{ key: "label", label: "Name", required: true, full: true }]} initial={{ label: b.label }}
        onSave={async (v) => { await send(`/api/bins/register/${b.id}`, { action: "rename", label: v.label }); onDone("Renamed."); }} />
    ) : (
      <FormModal title={`Retire ${b.label}`} submitLabel="Retire" onClose={onClose} fields={[reason]} initial={{ reason: "" }}
        onSave={async (v) => { await send(`/api/bins/register/${b.id}`, { action: "retire", reason: v.reason }); onDone(`${b.label} retired - it stays in the history.`); }} />
    );
  }
  if (!("row" in modal)) return null;
  const r = modal.row;
  if (modal.kind === "cancel" || modal.kind === "unpick") {
    return (
      <FormModal title={modal.kind === "cancel" ? `Cancel this entry (${r.bin}, ${r.project})` : `Put ${r.bin} back on site at ${r.project}`}
        submitLabel={modal.kind === "cancel" ? "Cancel entry" : "Put back on site"} onClose={onClose} fields={[reason]} initial={{ reason: "" }}
        onSave={async (v) => { await send(`/api/bins/${r.id}`, { action: modal.kind, reason: v.reason }); onDone(modal.kind === "cancel" ? "Entry cancelled - it's kept, marked cancelled." : "Back on site."); }} />
    );
  }
  const binChoices = [{ value: "", label: "No particular bin (size only)" }, ...data.register.filter((b) => !b.retired).map((b) => ({ value: b.id, label: `${b.label} (${b.size})` }))];
  const projectChoices = data.pickProjects.some((p) => p.id === r.projectId) ? data.pickProjects : [{ id: r.projectId, label: r.project }, ...data.pickProjects];
  const initial = { projectId: r.projectId, use: r.useKey, size: r.sizeKey, binId: r.binId ?? "", contents: r.contentsKey, contentsNote: r.contentsNote ?? "", reason: "" };
  return (
    <FormModal title={`Correct ${r.bin} at ${r.project}`} onClose={onClose}
      fields={[
        { key: "projectId", label: "Job", type: "select", options: projectChoices.map((p) => ({ value: p.id, label: p.label })), full: true },
        { key: "use", label: "Client's or ours", type: "select", options: data.uses.map((u) => ({ value: u.key, label: u.label })) },
        { key: "size", label: "Size", type: "select", options: data.sizes.map((s) => ({ value: s.key, label: s.label })) },
        { key: "binId", label: "Bin", type: "select", options: binChoices },
        { key: "contents", label: "What's in it", type: "select", options: data.contents.map((c) => ({ value: c.key, label: c.label })) },
        { key: "contentsNote", label: "Note", full: true },
        reason,
      ]}
      initial={initial}
      onSave={async (v) => {
        const changed: Record<string, unknown> = {};
        for (const k of ["projectId", "use", "size", "binId", "contents", "contentsNote"] as const) if ((v[k] ?? "") !== (initial[k] ?? "")) changed[k] = v[k] === "" ? null : v[k];
        if (!Object.keys(changed).length) throw new Error("Nothing to change.");
        await send(`/api/bins/${r.id}`, { action: "correct", ...changed, reason: v.reason });
        onDone("Corrected - the change is in its History.");
      }} />
  );
}
