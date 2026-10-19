"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Camera, Loader2, ScanLine, Wrench } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import CheckResultView from "@/components/tools/CheckResultView";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { CheckResult } from "@/lib/toolboxCheck";

// Site photos: the page a supervisor opens from their private link (saved to
// their phone's home screen). It can only send photos - register a tool,
// check their toolbox, report a fault. No login; the link is the key.

type SiteTool = { id: string; tag: string; name: string; brand: string | null; model: string | null; serialNumber: string | null; condition: string };
type SiteInfo = { person: string; toolboxes: { id: string; name: string; tools: SiteTool[] }[] };
type Mode = "home" | "register" | "check" | "fault";

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";

export default function SitePhotosPage({ params }: { params: { token: string } }) {
  const api = `/api/site/${params.token}`;
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("home");
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(api);
    if (!res.ok) return setDead(await serverErrorMessage(res, "This link isn't working. Ask the office for a new one."));
    setInfo(await res.json());
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  const finished = (message: string) => {
    setFlash(message);
    setMode("home");
    load();
  };

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-5">
      <div className="mb-5 flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Lobos" className="h-7" />
        {info && <span className="text-sm text-gray-400">{info.person}</span>}
      </div>

      {dead ? (
        <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{dead}</div>
      ) : !info ? (
        <div className="py-16 text-center text-sm text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
      ) : mode === "home" ? (
        <>
          <h1 className="mb-1 text-xl font-semibold text-gray-100">Site photos</h1>
          <p className="mb-4 text-sm text-gray-500">Tools for {info.toolboxes.map((b) => b.name).join(", ")}.</p>
          {flash && <div className="mb-4 rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {flash}</div>}
          <div className="space-y-3">
            <Big icon={<Camera size={22} />} title="Register a tool" text="Photos and/or type the details" onClick={() => { setFlash(null); setMode("register"); }} />
            <Big icon={<ScanLine size={22} />} title="Check my toolbox" text="Photo of your tools laid out" onClick={() => { setFlash(null); setMode("check"); }} />
            <Big icon={<Wrench size={22} />} title="Report a fault" text="Not working, damaged, needs a Hilti swap" onClick={() => { setFlash(null); setMode("fault"); }} />
          </div>
          <p className="mt-8 text-center text-xs text-gray-600">
            Tip: add this page to your home screen (Share → Add to Home Screen) so it opens like an app. Don&apos;t share your link.
          </p>
        </>
      ) : (
        <>
          <button onClick={() => setMode("home")} className="mb-4 flex items-center gap-1 text-sm text-gray-400">
            <ArrowLeft size={16} /> Back
          </button>
          {mode === "register" && <RegisterTool api={api} onDone={finished} />}
          {mode === "check" && <CheckBox api={api} info={info} />}
          {mode === "fault" && <ReportFault api={api} info={info} onDone={finished} />}
        </>
      )}
    </div>
  );
}

function Big({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 rounded-2xl border border-edge bg-panel p-4 text-left active:scale-[0.99]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600/20 text-brand-300">{icon}</span>
      <span>
        <span className="block text-base font-semibold text-gray-100">{title}</span>
        <span className="block text-sm text-gray-500">{text}</span>
      </span>
    </button>
  );
}

async function post(api: string, body: unknown) {
  const res = await fetch(`${api}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
  return res.json();
}

function RegisterTool({ api, onDone }: { api: string; onDone: (m: string) => void }) {
  const [plate, setPlate] = useState<string | null>(null);
  const [cond, setCond] = useState<string | null>(null);
  const [manual, setManual] = useState({ toolType: "", brand: "", model: "", serialNumber: "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof manual) => (e: { target: { value: string } }) => setManual((m) => ({ ...m, [k]: e.target.value }));
  // A plate photo, or at least what the tool is typed in.
  const ready = !!plate || !!manual.toolType.trim();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Register a tool</h1>
      <p className="text-sm text-gray-400">Take the photos, type the details in yourself, or both.</p>
      <PhotoPicker big kind="PLATE" uploadUrl={`${api}/photos`} label="1. Rating plate photo" hint="Close up, in focus, no glare. Take the battery off if the plate is under it." photoId={plate} onChange={setPlate} />
      <PhotoPicker big kind="CONDITION" uploadUrl={`${api}/photos`} label="2. Whole tool photo" hint="Show any damage or wear." photoId={cond} onChange={setCond} />
      <div className="space-y-2 rounded-xl border border-edge bg-panel p-3">
        <div className="text-sm font-medium text-gray-200">Or enter the details yourself</div>
        <input className={input} placeholder={plate ? "What it is (optional)" : "What it is, e.g. Hammer drill"} value={manual.toolType} onChange={set("toolType")} />
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder="Brand, e.g. Hilti" value={manual.brand} onChange={set("brand")} />
          <input className={input} placeholder="Model, e.g. SF 6H-22" value={manual.model} onChange={set("model")} />
        </div>
        <input className={input} placeholder="Serial number (from the plate)" value={manual.serialNumber} onChange={set("serialNumber")} autoCapitalize="characters" />
        <p className="text-xs text-gray-500">Anything you type here is used instead of what the photo reads.</p>
      </div>
      <input className={input} placeholder="Anything else to add? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <button
        className={primary}
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await post(api, { kind: "REGISTER", platePhotoId: plate, conditionPhotoId: cond, manual, note });
            onDone(r.message);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 size={18} className="animate-spin" />} {busy ? (plate ? "Reading and sending…" : "Sending…") : "Send to the office"}
      </button>
      {!ready && <p className="text-center text-xs text-gray-500">Add the plate photo or type what the tool is to send.</p>}
    </div>
  );
}

function CheckBox({ api, info }: { api: string; info: SiteInfo }) {
  const [boxId, setBoxId] = useState(info.toolboxes[0]?.id ?? "");
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const box = info.toolboxes.find((b) => b.id === boxId);

  async function action(toolId: string, kind: "MINE" | "MISSING") {
    setError(null);
    try {
      const r = await post(api, { kind: "CHECK_ACTION", action: kind, toolId, toolboxId: boxId });
      setDone((d) => ({ ...d, [toolId]: r.message }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (result && box) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-100">{box.name}</h1>
        {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
        <CheckResultView
          result={result}
          boxName={box.name}
          done={done}
          onSendBack={(toolId, belongsTo) => setDone((d) => ({ ...d, [toolId]: `Give it back to ${belongsTo ?? "the yard"}` }))}
          onMine={(toolId) => action(toolId, "MINE")}
          onMissing={(toolId) => action(toolId, "MISSING")}
        />
        <button className={primary} onClick={() => { setResult(null); setPhotos([null]); setDone({}); }}>Check again</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Check my toolbox</h1>
      {info.toolboxes.length > 1 && (
        <select className={input} value={boxId} onChange={(e) => setBoxId(e.target.value)}>
          {info.toolboxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <p className="text-sm text-gray-400">Lay the tools out with their LOB labels (or rating plates) facing up. 1–4 photos.</p>
      {photos.map((p, i) => (
        <PhotoPicker
          key={i}
          big
          kind="CHECK"
          uploadUrl={`${api}/photos`}
          label={`Photo ${i + 1}`}
          photoId={p}
          onChange={(id) => setPhotos((ps) => ps.map((x, j) => (j === i ? id : x)))}
        />
      ))}
      {photos.length < 4 && (
        <button className="w-full rounded-xl border border-edge px-4 py-2.5 text-sm text-gray-300" onClick={() => setPhotos((ps) => [...ps, null])}>
          + Another photo
        </button>
      )}
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <button
        className={primary}
        disabled={busy || !photos.some(Boolean)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await post(api, { kind: "CHECK", toolboxId: boxId, photoIds: photos.filter(Boolean) });
            setResult(r.result);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 size={18} className="animate-spin" />} {busy ? "Checking…" : "Check toolbox"}
      </button>
    </div>
  );
}

function ReportFault({ api, info, onDone }: { api: string; info: SiteInfo; onDone: (m: string) => void }) {
  const [toolId, setToolId] = useState("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Report a fault</h1>
      <select className={input} value={toolId} onChange={(e) => setToolId(e.target.value)}>
        <option value="">Which tool?</option>
        {info.toolboxes.map((b) => (
          <optgroup key={b.id} label={b.name}>
            {b.tools.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tag} · {t.name}{t.serialNumber ? ` · ${t.serialNumber}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <textarea className={`${input} min-h-[110px]`} placeholder="What's wrong? e.g. not hammering, cuts out, cracked housing" value={text} onChange={(e) => setText(e.target.value)} />
      <PhotoPicker big kind="FAULT" uploadUrl={`${api}/photos`} label="Photo of the fault (optional)" photoId={photo} onChange={setPhoto} />
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <button
        className={primary}
        disabled={!toolId || !text.trim() || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await post(api, { kind: "FAULT", toolId, description: text, photoId: photo });
            onDone(r.message);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 size={18} className="animate-spin" />} {busy ? "Sending…" : "Send to the office"}
      </button>
    </div>
  );
}
