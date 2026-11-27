"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, Loader2, Plus, Send, X } from "lucide-react";
import MediaUpload from "./MediaUpload";
import SignaturePad from "./SignaturePad";
import { serverErrorMessage } from "@/lib/apiFetch";
import { mediaIdOf } from "@/lib/media/rules";
import { LIMITS, TICKS, UNITS, docketNo, hoursText, spanHours, taskHours, tickLabel, unitLabel, type LinkDocketDTO, type LinkViewDTO } from "@/lib/variations/rules";

// The Variation / Day docket on a supervisor's phone (Ilies, 25 Nov 2026) - his paper docket, top to bottom: the job
// (project details filled in), the ticks, the variation works (hours worked out from the times and men - and editable),
// the equipment / tool / materials / waste rows, photos, then the client signs with a finger, then the supervisor.
// Send stays off until the client has signed. The number (V-0001 ...) comes back on Send. A sent docket can't be
// changed - a correction is a new docket that says which one it replaces. No prices anywhere: the office prices it.
// Mobile-first: one column, big tap targets, everything reachable with a thumb.

const input = "w-full rounded-xl border border-edge bg-panel2 px-3 py-3 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-4 text-base font-semibold text-white disabled:opacity-40";
const secondary = "flex w-full items-center justify-center gap-2 rounded-xl border border-edge bg-panel px-4 py-3.5 text-base font-semibold text-gray-200 active:bg-panel2";
const card = "rounded-2xl border border-edge bg-panel p-4";
const h2 = "mb-2 text-base font-semibold text-gray-100";

type Task = { key: number; description: string; men: string; start: string; finish: string; hours: string; edited: boolean };
type Item = { key: number; quantity: string; unit: string; type: string; comment: string };
let nextKey = 1;
const blankTask = (): Task => ({ key: nextKey++, description: "", men: "", start: "", finish: "", hours: "", edited: false });
const blankItem = (): Item => ({ key: nextKey++, quantity: "", unit: "M3", type: "", comment: "" });
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const calcOf = (t: Task) => taskHours({ men: t.men ? Number(t.men) : null, start: t.start, finish: t.finish });

export default function VariationDocketScreen({ api, onHome }: { api: string; onHome: () => void }) {
  const [view, setView] = useState<LinkViewDTO | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [sent, setSent] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`${api}/variation`).catch(() => null);
    if (!r || !r.ok) return setDead(r ? await serverErrorMessage(r, "Variation dockets aren't available on this link.") : "No signal - try again.");
    setView(await r.json());
  }, [api]);
  useEffect(() => { load(); }, [load]);

  if (dead) return <div className={`${card} text-center text-sm text-gray-300`}>{dead}</div>;
  if (!view) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;
  if (mode === "form") {
    return <DocketForm api={api} view={view} onCancel={() => setMode("list")} onSent={(d) => { setSent(`Sent - ${d.number}. The office has it.`); setMode("list"); window.scrollTo(0, 0); load(); }} />;
  }
  const full = view.sentToday >= view.perDay;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Variation docket</h1>
      <p className="text-sm text-gray-400">Extra work, labour hire, materials, rubbish removal or tool hire the client asked for. Fill it in, the client signs on your phone, then you sign. No prices - the office prices it.</p>
      {sent && <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {sent}</div>}
      {view.jobs.length === 0 ? (
        <div className={`${card} text-sm text-gray-300`}>You haven&apos;t been on a job today or in the last two days, so there&apos;s nothing to do a docket for. If that&apos;s wrong, call the office.</div>
      ) : full ? (
        <div className={`${card} text-sm text-amber-300`}>That&apos;s {view.perDay} dockets today - call the office.</div>
      ) : (
        <button className={primary} onClick={() => { setSent(null); setMode("form"); window.scrollTo(0, 0); }}><Plus size={20} /> New docket</button>
      )}
      <section>
        <h2 className={h2}>Sent from this link</h2>
        {view.sent.length === 0 ? <p className="text-sm text-gray-500">None in the last week.</p> : (
          <div className="space-y-3">{view.sent.map((d) => <SentCard key={d.id} d={d} />)}</div>
        )}
        <p className="mt-2 text-xs text-gray-500">Sent dockets can&apos;t be changed. To fix one, do a new docket and pick the one it replaces.</p>
      </section>
      <button className={secondary} onClick={onHome}><ChevronLeft size={18} /> Back to the site page</button>
    </div>
  );
}

function SentCard({ d }: { d: LinkDocketDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={card}>
      <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0">
          <span className="block font-semibold text-gray-100">{d.number} · {d.project}</span>
          <span className="block text-sm text-gray-400">{day(d.day)} · signed by {d.customerName}{d.replaces ? ` · replaces ${d.replaces}` : ""}</span>
        </span>
        <span className="shrink-0 text-xs text-gray-500">{when(d.sentAt)}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-edge/60 pt-3 text-sm text-gray-300">
          <p className="text-gray-400">{d.ticks.map(tickLabel).join(" · ")}</p>
          {d.tasks.map((t) => (
            <p key={`t${t.n}`}><span className="text-gray-500">Task {t.n}:</span> {t.description}{t.men ? ` · ${t.men} men` : ""}{t.start ? ` · ${t.start}-${t.finish}` : ""}{t.hours != null ? ` · ${hoursText(t.hours)}` : ""}</p>
          ))}
          {d.items.map((x) => (
            <p key={`i${x.n}`}><span className="text-gray-500">Item:</span> {x.quantity != null ? `${x.quantity} ${unitLabel(x.unit)} ` : ""}{x.type}{x.comment ? ` - ${x.comment}` : ""}</p>
          ))}
          {d.photos > 0 && <p className="text-gray-500">{d.photos} photo{d.photos === 1 ? "" : "s"}</p>}
        </div>
      )}
    </div>
  );
}

function DocketForm({ api, view, onCancel, onSent }: { api: string; view: LinkViewDTO; onCancel: () => void; onSent: (d: LinkDocketDTO) => void }) {
  const [jobId, setJobId] = useState(view.jobs.length === 1 ? view.jobs[0].id : "");
  const job = view.jobs.find((j) => j.id === jobId) ?? null;
  const [ticks, setTicks] = useState<string[]>([]);
  const [otherText, setOtherText] = useState("");
  const [tasks, setTasks] = useState<Task[]>([blankTask()]);
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [replaces, setReplaces] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPosition, setCustomerPosition] = useState("");
  const [customerSig, setCustomerSig] = useState<string | null>(null);
  const [lobosPosition, setLobosPosition] = useState("Site supervisor");
  const [lobosSig, setLobosSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTask = (key: number, p: Partial<Task>) => setTasks((ts) => ts.map((t) => (t.key === key ? { ...t, ...p } : t)));
  const setItem = (key: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const hoursOf = (t: Task) => (t.edited ? (t.hours === "" ? null : Number(t.hours)) : calcOf(t));
  const filledTasks = tasks.filter((t) => t.description.trim() || t.start || t.finish || t.men);
  const filledItems = items.filter((x) => x.type.trim() || x.quantity || x.comment.trim());
  const sameJob = useMemo(() => view.sent.filter((d) => job && d.project === job.projectName), [view.sent, job]);

  // What still stops Send - in the order the screen asks for it.
  const missing = !job ? "Pick the job."
    : !ticks.length ? "Tick what the docket is for."
    : ticks.includes("OTHER") && otherText.trim().length < 2 ? "Say what \"Other\" is."
    : !filledTasks.length && !filledItems.length ? "Add a task, or the equipment / materials used."
    : filledTasks.some((t) => t.description.trim().length < 2) ? "Describe the work on each task."
    : filledTasks.some((t) => (!!t.start) !== (!!t.finish)) ? "Put both the start and the finish on each task (or neither)."
    : filledItems.some((x) => !x.type.trim()) ? "Say what each equipment / materials row is."
    : uploading ? "Wait for the photos to finish sending."
    : customerName.trim().length < 2 ? "The client's name."
    : !customerSig ? "The client needs to sign."
    : !lobosSig ? "Sign it yourself (Lobos sign-off)."
    : null;

  async function send() {
    if (missing || !job) return;
    setBusy(true); setError(null);
    const body = {
      jobId: job.id, ticks, otherText, note, photoIds: photos.map((p) => mediaIdOf(p)).filter(Boolean),
      tasks: filledTasks.map((t) => ({ description: t.description, men: t.men ? Number(t.men) : null, start: t.start || null, finish: t.finish || null, hours: t.edited ? (t.hours === "" ? null : Number(t.hours)) : null })),
      items: filledItems.map((x) => ({ quantity: x.quantity === "" ? null : Number(x.quantity), unit: x.unit, type: x.type, comment: x.comment })),
      customerName, customerPosition, customerSignature: customerSig, lobosPosition, lobosSignature: lobosSig, replaces: replaces || null,
    };
    const r = await fetch(`${api}/variation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't send - no signal? Nothing was lost - try again.");
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't send - try again."));
    const j = await r.json();
    onSent(j.docket as LinkDocketDTO);
  }

  return (
    <div className="space-y-4 pb-24">
      <button onClick={onCancel} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back - nothing is sent</button>
      <h1 className="text-xl font-semibold text-gray-100">New variation docket</h1>

      <section className={card}>
        <h2 className={h2}>1. The job</h2>
        {view.jobs.length > 1 && (
          <select className={input} value={jobId} onChange={(e) => { setJobId(e.target.value); setPhotos([]); setReplaces(""); }}>
            <option value="">Which job?</option>
            {view.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
        )}
        {job && (
          <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-y-1 text-sm">
            <dt className="text-gray-500">Date</dt><dd className="text-gray-200">{day(job.day)}{job.night ? " (night)" : ""}</dd>
            <dt className="text-gray-500">Project</dt><dd className="text-gray-200">{job.projectName}{job.jobNo ? ` · ${job.jobNo}` : ""}</dd>
            <dt className="text-gray-500">Address</dt><dd className="text-gray-200">{job.address || "-"}</dd>
            <dt className="text-gray-500">Client</dt><dd className="text-gray-200">{job.client || "-"}</dd>
            <dt className="text-gray-500">Docket #</dt><dd className="text-gray-400">Given when you send it</dd>
          </dl>
        )}
      </section>

      <section className={card}>
        <h2 className={h2}>2. Please tick</h2>
        <div className="grid grid-cols-2 gap-2">
          {TICKS.map((t) => {
            const on = ticks.includes(t.key);
            return (
              <button key={t.key} type="button" aria-pressed={on} onClick={() => setTicks((xs) => (on ? xs.filter((x) => x !== t.key) : [...xs, t.key]))}
                className={`flex min-h-[3.25rem] items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold ${on ? "border-brand-500 bg-brand-600/25 text-white" : "border-edge bg-panel2 text-gray-300"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand-400 bg-brand-500 text-white" : "border-gray-500"}`}>{on && <Check size={16} />}</span>
                {t.label}
              </button>
            );
          })}
        </div>
        {ticks.includes("OTHER") && <input className={`${input} mt-2`} maxLength={LIMITS.otherText} placeholder="What is it?" value={otherText} onChange={(e) => setOtherText(e.target.value)} />}
      </section>

      <section className={card}>
        <h2 className={h2}>3. Variation works</h2>
        <p className="mb-2 text-xs text-gray-500">What was done, how many men, start and finish. Total hours = the time × the men - change it if it&apos;s not right.</p>
        <div className="space-y-3">
          {tasks.map((t, i) => {
            const calc = calcOf(t);
            const span = spanHours(t.start, t.finish);
            return (
              <div key={t.key} className="rounded-xl border border-edge/70 bg-panel2/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-200">Task {i + 1}</span>
                  {tasks.length > 1 && <button type="button" className="rounded-lg p-2 text-gray-400 active:bg-panel2" aria-label={`Remove task ${i + 1}`} onClick={() => setTasks((ts) => ts.filter((x) => x.key !== t.key))}><X size={18} /></button>}
                </div>
                <textarea className={`${input} min-h-[88px]`} maxLength={LIMITS.description} placeholder="Description of work - scope, what was asked for" value={t.description} onChange={(e) => setTask(t.key, { description: e.target.value })} />
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="block"><span className="mb-1 block text-xs text-gray-400">Men</span>
                    <input className={input} inputMode="numeric" pattern="[0-9]*" maxLength={2} value={t.men} onChange={(e) => setTask(t.key, { men: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></label>
                  <label className="block"><span className="mb-1 block text-xs text-gray-400">Start</span>
                    <input type="time" className={input} value={t.start} onChange={(e) => setTask(t.key, { start: e.target.value })} /></label>
                  <label className="block"><span className="mb-1 block text-xs text-gray-400">Finish</span>
                    <input type="time" className={input} value={t.finish} onChange={(e) => setTask(t.key, { finish: e.target.value })} /></label>
                </div>
                <label className="mt-2 block"><span className="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>Total hrs spent{span != null ? ` (${span} h${t.men && Number(t.men) > 1 ? ` × ${t.men} men` : ""})` : ""}</span>
                  {t.edited && calc != null && <button type="button" className="text-brand-300" onClick={() => setTask(t.key, { edited: false, hours: "" })}>Use {calc} h</button>}
                </span>
                  <input className={input} inputMode="decimal" placeholder={calc != null ? String(calc) : "Hours"} value={t.edited ? t.hours : calc != null ? String(calc) : ""}
                    onChange={(e) => setTask(t.key, { edited: true, hours: e.target.value.replace(/[^0-9.]/g, "").slice(0, 6) })} />
                </label>
              </div>
            );
          })}
        </div>
        {tasks.length < view.limits.tasks && <button type="button" className={`${secondary} mt-3`} onClick={() => setTasks((ts) => [...ts, blankTask()])}><Plus size={18} /> Another task</button>}
      </section>

      <section className={card}>
        <h2 className={h2}>4. Equipment / tools / materials / waste</h2>
        <p className="mb-2 text-xs text-gray-500">Quantity (or total m³), what it is, and any comments.</p>
        <div className="space-y-3">
          {items.map((x, i) => (
            <div key={x.key} className="rounded-xl border border-edge/70 bg-panel2/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-200">Row {i + 1}</span>
                <button type="button" className="rounded-lg p-2 text-gray-400 active:bg-panel2" aria-label={`Remove row ${i + 1}`} onClick={() => setItems((xs) => xs.filter((y) => y.key !== x.key))}><X size={18} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="mb-1 block text-xs text-gray-400">Quantity</span>
                  <input className={input} inputMode="decimal" value={x.quantity} onChange={(e) => setItem(x.key, { quantity: e.target.value.replace(/[^0-9.]/g, "").slice(0, 9) })} /></label>
                <label className="block"><span className="mb-1 block text-xs text-gray-400">Unit</span>
                  <select className={input} value={x.unit} onChange={(e) => setItem(x.key, { unit: e.target.value })}>{UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}</select></label>
              </div>
              <input className={`${input} mt-2`} maxLength={LIMITS.type} placeholder="Type - e.g. 5t excavator, mixed waste, plasterboard" value={x.type} onChange={(e) => setItem(x.key, { type: e.target.value })} />
              <input className={`${input} mt-2`} maxLength={LIMITS.comment} placeholder="Comments (optional)" value={x.comment} onChange={(e) => setItem(x.key, { comment: e.target.value })} />
            </div>
          ))}
        </div>
        {items.length < view.limits.items && <button type="button" className={`${secondary} mt-3`} onClick={() => setItems((xs) => [...xs, blankItem()])}><Plus size={18} /> Add a row</button>}
      </section>

      <section className={card}>
        <h2 className={h2}>5. Photos and a note (optional)</h2>
        {view.media.on && job ? (
          <>
            {photos.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {photos.map((p) => {
                  const id = mediaIdOf(p);
                  return (
                    <span key={p} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {id && <img src={`${api}/variation/media/${id}`} alt="" className="h-16 w-16 rounded-lg object-cover" />}
                      <button type="button" className="absolute -right-1 -top-1 rounded-full bg-black/70 p-1 text-white" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))}><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <MediaUpload api={{ start: `${api}/variation/media/start`, parts: `${api}/variation/media/parts`, complete: `${api}/variation/media/complete` }}
              fields={{ area: "VARIATION", jobId: job.id }} kinds={["PHOTO"]} room={{ items: view.limits.photos - photos.length, videos: 0 }} busyChange={setUploading}
              onDone={(r) => { const ref = typeof r.body.ref === "string" ? r.body.ref : null; if (ref) setPhotos((ps) => [...ps, ref]); }} />
          </>
        ) : (
          <p className="text-sm text-gray-500">{job ? "Photos can't be added right now - send it without, and send photos to the office if you need to." : "Pick the job first."}</p>
        )}
        <textarea className={`${input} mt-3 min-h-[80px]`} maxLength={LIMITS.note} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {sameJob.length > 0 && (
          <label className="mt-3 block"><span className="mb-1 block text-sm text-gray-300">Fixing a docket you sent? (optional)</span>
            <select className={input} value={replaces} onChange={(e) => setReplaces(e.target.value)}>
              <option value="">No - this is a new one</option>
              {sameJob.map((d) => <option key={d.id} value={d.number}>Replaces {d.number} ({day(d.day)})</option>)}
            </select>
          </label>
        )}
      </section>

      <section className={`${card} border-amber-500/40`}>
        <h2 className={h2}>6. Customer sign-off</h2>
        <p className="mb-3 text-sm text-gray-400">Hand the phone to the client. They check it, type their name and sign.</p>
        <div className="space-y-2">
          <input className={input} maxLength={LIMITS.name} autoComplete="off" placeholder="Client's name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <input className={input} maxLength={LIMITS.position} autoComplete="off" placeholder="Position (e.g. site manager)" value={customerPosition} onChange={(e) => setCustomerPosition(e.target.value)} />
          <SignaturePad label="Client's signature" onChange={setCustomerSig} />
          {/* VD-005 (Ilies approved 25 Nov 2026): the one line the client reads before signing. */}
          <p className="text-xs text-gray-400">Lobos keeps this docket, your name and signature as the record of this work.</p>
          <p className="text-xs text-gray-500">Date: today, when it&apos;s sent.</p>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>7. Lobos sign-off</h2>
        <div className="space-y-2">
          <div className="rounded-xl border border-edge bg-panel2 px-3 py-3 text-base text-gray-200">{view.lobosName}</div>
          <input className={input} maxLength={LIMITS.position} placeholder="Position" value={lobosPosition} onChange={(e) => setLobosPosition(e.target.value)} />
          <SignaturePad label="Your signature" onChange={setLobosSig} />
        </div>
      </section>

      {error && <div className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      <div className="sticky bottom-0 -mx-4 border-t border-edge bg-panel/95 px-4 pb-4 pt-3 backdrop-blur">
        <button className={primary} disabled={!!missing || busy} onClick={send}>
          {busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />} {busy ? "Sending…" : "Send to the office"}
        </button>
        <p className={`mt-1.5 text-center text-xs ${missing ? "text-amber-300" : "text-gray-500"}`}>{missing ?? `It gets its docket number (like ${docketNo(12)}) when it's sent. It can't be changed after.`}</p>
      </div>
    </div>
  );
}
