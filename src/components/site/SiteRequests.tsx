"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { resizePhoto } from "@/lib/imageResize";
import { serverErrorMessage } from "@/lib/apiFetch";
import {
  PRIORITIES,
  PRIORITY_DOT,
  PRIORITY_HINT,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  REQUEST_TYPES,
  STATUS_FOR_SITE,
  defaultNeededBy,
  requestNo,
  whenText,
  type Priority,
  type RequestType,
} from "@/lib/requestTypes";
import type { SiteRequestView } from "@/lib/siteRequests";

// Site requests on the supervisor's link (21 Oct 2026) - instead of WhatsApp.
// "Make a request": what -> a few questions -> site, priority, needed by ->
// optional note / photo -> Send. "My requests": where each one is up to.

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";

type Sites = { mine: { id: string; name: string }[]; others: { id: string; name: string }[] };

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm".
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function RequestForm({ api, who, onDone }: { api: string; who: string; onDone: (m: string) => void }) {
  const [sites, setSites] = useState<Sites | null>(null);
  const [type, setType] = useState<RequestType | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<Priority | null>(null);
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${api}/requests`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { sites: Sites }) => {
        setSites(d.sites);
        if (d.sites.mine.length === 1) setProjectId(d.sites.mine[0].id);
      })
      .catch(() => setError("Couldn't load your sites - check your signal."));
  }, [api]);

  const pickType = (t: RequestType) => {
    setType(t);
    setDetails({});
    if (t.defaultPriority) pickPriority(t.defaultPriority);
  };
  const pickPriority = (p: Priority) => {
    setPriority(p);
    setNeededBy(localInput(defaultNeededBy(p)));
  };

  async function addPhoto(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      setPhoto(await resizePhoto(f));
    } catch {
      setError("Couldn't use that photo - try another.");
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  async function send() {
    if (!type) return;
    setError(null);
    const missing = type.fields.find((f) => f.required && !(details[f.key] ?? "").trim());
    if (missing) return setError(`Fill in "${missing.label}".`);
    if (!projectId) return setError("Pick the site.");
    if (!priority) return setError("Pick how urgent it is.");
    if (!neededBy) return setError("Pick when it's needed by.");
    setBusy(true);
    try {
      const res = await fetch(`${api}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: type.kind, details, projectId, priority, neededBy: new Date(neededBy).toISOString(), note, photo, who }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
      const { request } = (await res.json()) as { request: SiteRequestView };
      onDone(`${requestNo(request.number)} sent to the office - you'll see it change here once it's seen.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!type) {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-gray-100">Make a request</h1>
        <p className="mb-4 text-sm text-gray-500">What do you need?</p>
        <div className="grid grid-cols-2 gap-2">
          {REQUEST_TYPES.map((t) => (
            <button key={t.kind} onClick={() => pickType(t)} className="rounded-xl border border-edge bg-panel px-3 py-4 text-left text-sm font-semibold text-gray-100 active:scale-[0.99]">
              {t.label}
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">{type.label}</h1>
        <button onClick={() => setType(null)} className="text-sm text-gray-400 underline">Change</button>
      </div>

      {type.fields.map((f) => (
        <label key={f.key} className="block">
          <span className="mb-1 block text-sm text-gray-300">
            {f.label}
            {f.required && <span className="text-red-400"> *</span>}
          </span>
          {f.type === "select" ? (
            <div className="flex flex-wrap gap-2">
              {f.options!.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setDetails((d) => ({ ...d, [f.key]: o }))}
                  className={`rounded-lg border px-3 py-2 text-sm ${details[f.key] === o ? "border-brand-500 bg-brand-600/25 text-brand-200" : "border-edge bg-panel2 text-gray-300"}`}
                >
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <input
              className={input}
              inputMode={f.type === "number" ? "numeric" : undefined}
              placeholder={f.placeholder}
              value={details[f.key] ?? ""}
              onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          )}
        </label>
      ))}

      <label className="block">
        <span className="mb-1 block text-sm text-gray-300">Site <span className="text-red-400">*</span></span>
        <select className={input} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!sites}>
          <option value="">{sites ? "Pick the site" : "Loading…"}</option>
          {!!sites?.mine.length && (
            <optgroup label="Your sites">
              {sites.mine.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          )}
          {!!sites?.others.length && (
            <optgroup label="Other sites">
              {sites.others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          )}
        </select>
      </label>

      <div>
        <span className="mb-1 block text-sm text-gray-300">How urgent <span className="text-red-400">*</span></span>
        <div className="space-y-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => pickPriority(p)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${priority === p ? PRIORITY_TONE[p] : "border-edge bg-panel2 text-gray-300"}`}
            >
              <span className="text-lg">{PRIORITY_DOT[p]}</span>
              <span>
                <span className="block text-sm font-semibold">{PRIORITY_LABEL[p]}</span>
                <span className="block text-xs opacity-80">{PRIORITY_HINT[p]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {priority && (
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Needed by</span>
          <input type="datetime-local" className={input} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-sm text-gray-300">Anything else (optional)</span>
        <textarea className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Access, who to call on site, etc." />
      </label>

      {/* Photo is optional - only shows when they tap for it. */}
      <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhoto(e.target.files?.[0])} />
      {photo ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" className="max-h-56 w-full rounded-xl object-cover" />
          <button onClick={() => setPhoto(null)} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white" aria-label="Remove photo">
            <X size={16} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => file.current?.click()} className="flex items-center gap-2 text-sm text-gray-300 underline">
          <Camera size={16} /> Add a photo (optional)
        </button>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className={primary} onClick={send} disabled={busy}>
        {busy && <Loader2 size={18} className="animate-spin" />} Send request
      </button>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  SENT: "bg-gray-700/60 text-gray-300",
  SEEN: "bg-sky-500/15 text-sky-300",
  NEEDS_INFO: "bg-amber-500/20 text-amber-300",
  TODO: "bg-brand-600/25 text-brand-200",
  MINE: "bg-brand-600/25 text-brand-200",
  CANT_DO: "bg-brand-600/25 text-brand-200",
  DONE: "bg-emerald-500/15 text-emerald-300",
  DECLINED: "bg-red-500/15 text-red-300",
  CANCELLED: "bg-gray-700/40 text-gray-500",
};

export function MyRequests({ api }: { api: string }) {
  const [rows, setRows] = useState<SiteRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${api}/requests`).catch(() => null);
    if (!res?.ok) return setError("Couldn't load - check your signal.");
    setError(null);
    setRows(((await res.json()) as { requests: SiteRequestView[] }).requests);
  }, [api]);
  // Live: re-checks every 15 seconds while it's open.
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-gray-100">My requests</h1>
      <p className="mb-4 text-sm text-gray-500">Updates by itself. Last 14 days and anything still open.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!rows ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-gray-500" /></div>
      ) : !rows.length ? (
        <p className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-400">No requests yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => <MyRequest key={r.id} api={api} r={r} onChange={load} />)}
        </div>
      )}
    </>
  );
}

function MyRequest({ api, r, onChange }: { api: string; r: SiteRequestView; onChange: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const closed = ["DONE", "DECLINED", "CANCELLED"].includes(r.status);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${api}/requests/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - try again."));
      setAnswer("");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-xl border border-edge bg-panel p-4 ${closed ? "opacity-70" : ""}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{requestNo(r.number)} · {whenText(r.createdAt)}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status] ?? ""}`}>{STATUS_FOR_SITE[r.status] ?? r.status}</span>
      </div>
      <div className="text-base font-semibold text-gray-100">{PRIORITY_DOT[r.priority]} {r.summary}</div>
      <div className="text-sm text-gray-400">{r.site} · needed by {whenText(r.neededBy)}</div>
      {r.note && <div className="mt-1 text-sm text-gray-400">“{r.note}”</div>}
      {r.hasPhoto && (
        <button onClick={() => setShowPhoto((s) => !s)} className="mt-1 text-sm text-gray-300 underline">{showPhoto ? "Hide photo" : "Photo"}</button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {showPhoto && <img src={`${api}/requests/${r.id}/photo`} alt="" className="mt-2 max-h-64 w-full rounded-lg object-cover" />}

      {r.status === "NEEDS_INFO" && (
        <div className="mt-3 rounded-lg bg-amber-500/10 p-3">
          <div className="mb-2 text-sm text-amber-200">Office asks: {r.question}</div>
          <textarea className={input} rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" />
          <button className={`${primary} mt-2`} disabled={busy} onClick={() => act({ action: "ANSWER", answer })}>Send answer</button>
        </div>
      )}
      {r.status === "DONE" && r.outcome && <div className="mt-2 text-sm text-emerald-300">✓ {r.outcome}</div>}
      {r.status === "DECLINED" && r.declineReason && <div className="mt-2 text-sm text-red-300">Declined: {r.declineReason}</div>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {!closed && (
        <button
          className="mt-3 text-sm text-gray-500 underline"
          disabled={busy}
          onClick={() => {
            if (confirm("Cancel this request? Only if it's no longer needed.")) act({ action: "CANCEL" });
          }}
        >
          No longer needed - cancel
        </button>
      )}
    </div>
  );
}
