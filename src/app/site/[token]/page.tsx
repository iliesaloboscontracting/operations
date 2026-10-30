"use client";

import { useCallback, useEffect, useState, use } from "react";
import { ArrowLeft, Camera, ClipboardList, ListChecks, Loader2, NotebookPen, QrCode as QrIcon, ImagePlus, ClipboardCheck, ReceiptText, ScanLine, Send, ShoppingCart, Truck, Wrench, Wallet } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import DailyLog from "@/components/site/DailyLog";
import { GuideLink, WhatsNewCard } from "@/components/site/LogGuide";
import type { LogCardDTO } from "@/lib/dailyLog/types";
import SignInCrew from "@/components/site/SignInCrew";
import { MyRequests, RequestForm } from "@/components/site/SiteRequests";
import TodoList from "@/components/site/TodoList";
import MyPurchases from "@/components/purchases/MyPurchases";
import HireCheck from "@/components/site/HireCheck";
import { AddReceipt, MyReceipts } from "@/components/site/Receipts";
import Reimburse from "@/components/site/Reimburse";
import ApproveHours from "@/components/site/ApproveHours";
import SiteQuestions from "@/components/site/SiteQuestions";
import CheckResultView from "@/components/tools/CheckResultView";
import InstallApp from "@/components/InstallApp";
import SiteBrand from "@/components/site/SiteBrand";
import PushToggle from "@/components/PushToggle";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { CheckResult } from "@/lib/toolboxCheck";

// Site photos: the page a supervisor opens from their private link (saved to
// their phone's home screen). It can only send photos - register a tool,
// check their toolbox, report a fault. No login; the link is the key.

type SiteTool = { id: string; tag: string; name: string; brand: string | null; model: string | null; serialNumber: string | null; condition: string };
type SiteInfo = {
  person: string;
  kind: "SUPERVISOR" | "OFFICE" | "HANDOVER" | "DRIVER"; // DRIVER: receipts only (26 Oct 2026)
  shared?: boolean;
  toolboxes: { id: string; name: string; tools: SiteTool[] }[];
  openRequests: number;
  needsAnswer: number;
  todo: number;
  hireItems: number;
  hireToCheck: number;
  dailyLog?: LogCardDTO; // only on the daily log pilot's links (Task K)
  guide?: number; // the daily log guide's version - only on links with the daily log (30 Oct 2026)
  receiptsToday?: number; // supervisor and driver links (Receipts)
};
type Mode = "home" | "register" | "check" | "fault" | "signin" | "request" | "requests" | "todo" | "purchases" | "hire" | "log" | "receipt" | "receipts" | "hours" | "reimburse";

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";

export default function SitePhotosPage({ params: paramsP }: { params: Promise<{ token: string }> }) {
  const params = use(paramsP);
  const api = `/api/site/${params.token}`;
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("home");
  const [flash, setFlash] = useState<string | null>(null);
  const [who, setWho] = useState("");
  useEffect(() => setWho(getWho()), []);
  // A tapped alert opens ".../site/<link>?go=signin" - straight to crew sign-in
  // (or ?go=log - the 19:00 daily log reminder).
  useEffect(() => {
    const go = new URLSearchParams(window.location.search).get("go");
    if (go === "signin" || go === "log" || go === "purchases") {
      setMode(go);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(api);
    if (!res.ok) return setDead(await serverErrorMessage(res, "This link isn't working. Ask the office for a new one."));
    setInfo(await res.json());
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  // Tool features need a toolbox (or the office link); a hand-over link only runs sign-in.
  const hasTools = !!info && info.kind === "SUPERVISOR" && info.toolboxes.length > 0;
  const driver = info?.kind === "DRIVER";
  const sendsReceipts = !!info && (info.kind === "SUPERVISOR" || info.kind === "DRIVER");

  const finished = (message: string) => {
    setFlash(message);
    setMode("home");
    window.scrollTo(0, 0);
    load();
  };

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-5">
      <div className="mb-5 flex items-center justify-between">
        <SiteBrand />
        {info && <span className="text-sm text-gray-400">{info.person}</span>}
      </div>

      {dead ? (
        <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{dead}</div>
      ) : !info ? (
        <div className="py-16 text-center text-sm text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
      ) : mode === "home" ? (
        <>
          <h1 className="mb-1 text-xl font-semibold text-gray-100">{info.kind === "OFFICE" ? (info.shared ? "Tools capture" : "Office") : info.kind === "HANDOVER" ? "Crew sign-in" : driver ? "Receipts" : "Site"}</h1>
          <p className="mb-4 text-sm text-gray-500">
            {info.kind === "OFFICE"
              ? info.shared
                ? "Add tools to the Lobos inventory."
                : "Your to-do from site requests, and adding tools to the inventory."
              : info.kind === "HANDOVER"
                ? "You're running sign-in for today - this link stops working tonight."
                : driver
                  ? "Photograph tip dockets and fuel receipts when you get them."
                : hasTools
                  ? `Crew sign-in, requests, and tools for ${info.toolboxes.map((b) => b.name).join(", ")}.`
                  : "Crew sign-in and requests for your jobs."}
          </p>
          {info.shared && (
            <label className="mb-4 block">
              <span className="mb-1 block text-sm text-gray-300">Your name</span>
              <input
                className={input}
                placeholder="So the office knows who added it"
                value={who}
                onChange={(e) => {
                  setWho(e.target.value);
                  saveWho(e.target.value);
                }}
              />
            </label>
          )}
          {info.guide && <WhatsNewCard version={info.guide} />}
          <InstallApp appName={info.kind === "OFFICE" && !info.shared ? "Lobos Office" : "Lobos Site"} />
          {info.kind !== "OFFICE" && !driver && (
            <div className="mb-4 rounded-xl border border-edge bg-panel p-3">
              <div className="text-sm font-semibold text-gray-100">{info.dailyLog ? "Reminders" : "Sign-out reminders"}</div>
              <p className="mb-2 text-xs text-gray-500">
                An alert 20 minutes before your shift finishes if anyone is still signed in
                {info.dailyLog ? ", and at 7pm if a job has no daily log or before/after photos." : "."}
              </p>
              <PushToggle api={`${api}/push`} sw="/site/sw.js" home={`/site/${params.token}`} align="start" />
            </div>
          )}
          {flash && <div className="mb-4 rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {flash}</div>}
          {!info.shared && info.kind !== "HANDOVER" && !driver && <SiteQuestions api={api} />}
          <div className="space-y-3">
            {sendsReceipts && (<>
              <Big icon={<ImagePlus size={22} />} title="Add receipt" text="Tip docket or fuel - a photo when you get it" onClick={() => { setFlash(null); setMode("receipt"); }} />
              <Big icon={<ReceiptText size={22} />} title="My receipts" text={info.receiptsToday ? `${info.receiptsToday} sent today` : "What you sent today"} onClick={() => { setFlash(null); setMode("receipts"); }} />
              <Big icon={<Wallet size={22} />} title="Reimbursement" text="Paid for something yourself? Get it back" onClick={() => { setFlash(null); setMode("reimburse"); }} />
            </>)}
            {info.kind !== "OFFICE" && !driver && (
              <Big icon={<QrIcon size={22} />} title="Sign in crew" text="Show the QR - crew scan it to sign in or out" onClick={() => { setFlash(null); setMode("signin"); }} />
            )}
            {info.dailyLog && info.dailyLog.jobs > 0 && (
              <Big
                icon={<NotebookPen size={22} />}
                title="Daily log"
                text={info.dailyLog.logged >= info.dailyLog.jobs && info.dailyLog.lastAt
                  ? `Logged ${new Date(info.dailyLog.lastAt).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" })} ✓${info.dailyLog.progressDue ? " · progress due this week" : ""}`
                  : `Not done today - about a minute${info.dailyLog.progressDue ? " · progress due this week" : ""}`}
                count={info.dailyLog.jobs - info.dailyLog.logged}
                alert={info.dailyLog.logged < info.dailyLog.jobs}
                onClick={() => { setFlash(null); setMode("log"); }}
              />
            )}
            {info.guide && <div className="-mt-1 text-center"><GuideLink /></div>}
            {info.dailyLog && info.dailyLog.jobs === 0 && info.dailyLog.progressDue && (
              <Big icon={<NotebookPen size={22} />} title="Progress this week" text="% complete for your jobs - due this week" alert onClick={() => { setFlash(null); setMode("log"); }} />
            )}
            {/* Accounts stage 2: the supervisor approves the day's hours after sign-out (supervisor links only). */}
            {info.kind === "SUPERVISOR" && (
              <Big icon={<ClipboardCheck size={22} />} title="Approve hours" text="Check your crew's hours for the day and approve" onClick={() => { setFlash(null); setMode("hours"); }} />
            )}
            {info.kind !== "OFFICE" && !driver && (<>
              <Big icon={<Send size={22} />} title="Make a request" text="Labour, trucks, hire, tools, materials - straight to the office" onClick={() => { setFlash(null); setMode("request"); }} />
              <Big
                icon={<ClipboardList size={22} />}
                title="My requests"
                text={info.needsAnswer ? `The office has a question on ${info.needsAnswer}` : info.openRequests ? `${info.openRequests} open - see where they're up to` : "See where they're up to"}
                count={info.needsAnswer || info.openRequests}
                alert={info.needsAnswer > 0}
                onClick={() => { setFlash(null); setMode("requests"); }}
              />
              {info.hireItems > 0 && (
                <Big
                  icon={<Truck size={22} />}
                  title="Hire on my site"
                  text={info.hireToCheck ? `${info.hireToCheck} to check - still needed?` : `${info.hireItems} on hire - all checked`}
                  count={info.hireToCheck}
                  alert={info.hireToCheck > 0}
                  onClick={() => { setFlash(null); setMode("hire"); }}
                />
              )}
            </>)}
            {info.kind === "OFFICE" && !info.shared && (
              <Big icon={<ListChecks size={22} />} title="My to-do" text={info.todo ? `${info.todo} to action` : "Requests the office hands you"} count={info.todo} onClick={() => { setFlash(null); setMode("todo"); }} />
            )}
            {/* Stage 6: purchase requests - personal office link only, never an amount. */}
            {info.kind === "OFFICE" && !info.shared && (
              <Big icon={<ShoppingCart size={22} />} title="Ask to buy something" text="And see your purchase requests" onClick={() => { setFlash(null); setMode("purchases"); }} />
            )}
            {(info.kind === "OFFICE" || hasTools) && (<>
            <Big icon={<Camera size={22} />} title="Add a tool" text="Photos and/or type the details" onClick={() => { setFlash(null); setMode("register"); }} />
            <Big icon={<ScanLine size={22} />} title={info.kind === "OFFICE" ? "Check a toolbox" : "Check my toolbox"} text="Photo of the tools laid out" onClick={() => { setFlash(null); setMode("check"); }} />
            {info.kind !== "OFFICE" && (
              <Big icon={<Wrench size={22} />} title="Report a fault" text="Not working, damaged, needs a Hilti swap" onClick={() => { setFlash(null); setMode("fault"); }} />
            )}
            </>)}
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
          {mode === "register" && <RegisterTool api={api} info={info} onDone={finished} />}
          {mode === "check" && <CheckBox api={api} info={info} />}
          {mode === "fault" && <ReportFault api={api} info={info} onDone={finished} />}
          {mode === "signin" && <SignInCrew api={api} />}
          {mode === "request" && <RequestForm api={api} who={who} onDone={finished} />}
          {mode === "requests" && <MyRequests api={api} />}
          {mode === "todo" && <TodoList api={api} />}
          {mode === "purchases" && <MyPurchases base={`${api}/purchases`} />}
          {mode === "hire" && <HireCheck api={api} onChange={load} />}
          {mode === "log" && <DailyLog api={api} onDone={finished} />}
          {mode === "receipt" && <AddReceipt api={api} onDone={finished} />}
          {mode === "receipts" && <MyReceipts api={api} />}
          {mode === "reimburse" && <Reimburse api={api} onDone={finished} />}
          {mode === "hours" && <ApproveHours api={api} onDone={finished} />}
        </>
      )}
    </div>
  );
}

function Big({ icon, title, text, count, alert, onClick }: { icon: React.ReactNode; title: string; text: string; count?: number; alert?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 rounded-2xl border border-edge bg-panel p-4 text-left active:scale-[0.99]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600/20 text-brand-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-gray-100">{title}</span>
        <span className={`block text-sm ${alert ? "text-amber-300" : "text-gray-500"}`}>{text}</span>
      </span>
      {!!count && <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${alert ? "bg-amber-500 text-black" : "bg-brand-600 text-white"}`}>{count}</span>}
    </button>
  );
}

// On a shared link (Yard) the person's name is kept on this phone and sent
// with everything, so the office can see who added a tool.
const WHO_KEY = "lobos-site-who";
function getWho() {
  try {
    return localStorage.getItem(WHO_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveWho(v: string) {
  try {
    localStorage.setItem(WHO_KEY, v);
  } catch {}
}

async function post(api: string, body: Record<string, unknown>) {
  const res = await fetch(`${api}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, who: getWho() }) });
  if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
  return res.json();
}

type ToolForm = {
  name: string; brand: string; model: string; serialNumber: string; itemNo: string; manufactured: string;
  condition: string; conditionNotes: string; notes: string; ownership: string; fleetRef: string; toolboxId: string;
};
const BLANK_TOOL: ToolForm = {
  name: "", brand: "", model: "", serialNumber: "", itemNo: "", manufactured: "",
  condition: "Good", conditionNotes: "", notes: "", ownership: "OWNED", fleetRef: "", toolboxId: "",
};

// Adding a tool: 1) photos and/or typed details -> 2) check what was read,
// fix anything, then "Add to inventory". It goes straight into the inventory.
function RegisterTool({ api, info, onDone }: { api: string; info: SiteInfo; onDone: (m: string) => void }) {
  const office = info.kind === "OFFICE";
  const [step, setStep] = useState<"photos" | "details">("photos");
  const [plate, setPlate] = useState<string | null>(null);
  const [cond, setCond] = useState<string | null>(null);
  const [form, setForm] = useState<ToolForm>({ ...BLANK_TOOL, toolboxId: office ? "" : info.toolboxes[0]?.id ?? "" });
  const [plateUnreadable, setPlateUnreadable] = useState(false);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ToolForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function next() {
    setError(null);
    setWarning(null);
    if (!plate && !cond) return setStep("details");
    setBusy(true);
    try {
      const r = await post(api, { kind: "READ", platePhotoId: plate, conditionPhotoId: cond });
      const x = r.reading;
      setForm((f) => ({
        ...f,
        name: x.toolType || f.name,
        brand: x.brand || f.brand,
        model: x.model || f.model,
        serialNumber: x.serialNumber || f.serialNumber,
        itemNo: x.itemNo || f.itemNo,
        manufactured: x.manufactured || f.manufactured,
        condition: x.conditionSuggestion === "Unclear" ? f.condition : x.conditionSuggestion,
        conditionNotes: x.damage || f.conditionNotes,
        notes: x.specs || f.notes,
      }));
      setUnsure([...(x.uncertainFields ?? []), ...(plate && !x.serialNumber ? ["serialNumber"] : [])]);
      setWarning(r.duplicate);
      setStep("details");
    } catch (e) {
      // Reading failed - carry on and type it in.
      setError((e as Error).message);
      setStep("details");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await post(api, {
        kind: "REGISTER",
        fields: form,
        plateUnreadable,
        platePhotoId: plate,
        conditionPhotoId: cond,
        toolboxId: form.toolboxId || null,
      });
      onDone(r.message);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const field = (k: keyof ToolForm, label: string, placeholder = "") => (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-sm text-gray-300">
        {label}
        {unsure.includes(k === "name" ? "toolType" : k) && <span className="rounded bg-amber-500/15 px-1 text-[11px] font-semibold text-amber-500">check this</span>}
      </span>
      <input className={input} placeholder={placeholder} value={form[k]} onChange={set(k)} />
    </label>
  );

  if (step === "photos") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-100">Add a tool</h1>
        <p className="text-sm text-gray-400">Take the photos and the details are read for you - or skip the photos and type them in.</p>
        <PhotoPicker big kind="PLATE" uploadUrl={`${api}/photos`} label="1. Rating plate photo" hint="Close up, in focus, no glare. Take the battery off if the plate is under it." photoId={plate} onChange={setPlate} />
        <PhotoPicker big kind="CONDITION" uploadUrl={`${api}/photos`} label="2. Whole tool photo" hint="Show any damage or wear." photoId={cond} onChange={setCond} />
        {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
        <button className={primary} disabled={busy} onClick={next}>
          {busy && <Loader2 size={18} className="animate-spin" />} {busy ? "Reading photos…" : plate || cond ? "Read photos" : "Type the details in"}
        </button>
      </div>
    );
  }

  const canSave = !!form.name.trim() && (plateUnreadable || !!form.serialNumber.trim()) && (office || !!form.toolboxId);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold text-gray-100">Check the details</h1>
      <p className="text-sm text-gray-400">{plate || cond ? "Read from your photos - fix anything that's wrong." : "Type in what's on the tool."}</p>
      {warning && <div className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-400">{warning}</div>}
      {field("name", "What it is *", "e.g. Hammer drill")}
      <div className="grid grid-cols-2 gap-2">
        {field("brand", "Brand", "e.g. Hilti")}
        {field("model", "Model", "e.g. SF 6H-22")}
      </div>
      <div className="rounded-xl border border-edge bg-panel p-3">
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-sm text-gray-300">
            Serial number *
            {unsure.includes("serialNumber") && !plateUnreadable && <span className="rounded bg-amber-500/15 px-1 text-[11px] font-semibold text-amber-500">check this</span>}
          </span>
          <input className={input} disabled={plateUnreadable} placeholder={plateUnreadable ? "Plate not readable" : "From the rating plate"} value={plateUnreadable ? "" : form.serialNumber} onChange={set("serialNumber")} autoCapitalize="characters" />
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" className="h-5 w-5" checked={plateUnreadable} onChange={(e) => setPlateUnreadable(e.target.checked)} />
          Plate not readable (worn, painted over or missing)
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {field("itemNo", "Item no. (Hilti)")}
        {field("manufactured", "Made", "e.g. 06/2026")}
      </div>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-300">Condition</span>
        <select className={input} value={form.condition} onChange={set("condition")}>
          {["New", "Good", "Needs repair"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      {field("conditionNotes", "Damage / wear", "Leave blank if none")}
      {(office || info.toolboxes.length > 1) && (
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Goes in</span>
          <select className={input} value={form.toolboxId} onChange={set("toolboxId")}>
            {office && <option value="">The yard (no toolbox)</option>}
            {info.toolboxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {office && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Ownership</span>
            <select className={input} value={form.ownership} onChange={set("ownership")}>
              <option value="OWNED">Lobos owned</option>
              <option value="HILTI_FLEET">Hilti fleet</option>
              <option value="HIRED">Hired</option>
            </select>
          </label>
          {form.ownership === "HILTI_FLEET" ? field("fleetRef", "Fleet ref") : <div />}
        </div>
      )}
      {field("notes", "Notes", "Specs or anything else")}
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <button className={primary} disabled={!canSave || busy} onClick={save}>
        {busy && <Loader2 size={18} className="animate-spin" />} {busy ? "Adding…" : "Add to inventory"}
      </button>
      {!canSave && <p className="text-center text-xs text-gray-500">Needs what it is, and a serial number or “Plate not readable”.</p>}
      <button className="w-full py-2 text-sm text-gray-400" onClick={() => setStep("photos")}>← Back to photos</button>
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
      <h1 className="text-xl font-semibold text-gray-100">{info.kind === "OFFICE" ? "Check a toolbox" : "Check my toolbox"}</h1>
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
