"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ScanLine, X } from "lucide-react";
import PhotoPicker from "./PhotoPicker";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { OWNERSHIP_LABEL, TOOL_CONDITIONS, TOOL_OWNERSHIP } from "@/lib/pickTool";
import type { ToolboxDTO } from "@/lib/types";

const input =
  "w-full rounded-lg border bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";

type Form = {
  tag: string; name: string; brand: string; model: string; serialNumber: string; itemNo: string;
  manufactured: string; condition: string; conditionNotes: string; ownership: string; fleetRef: string;
  toolboxId: string; notes: string;
};
const BLANK: Form = {
  tag: "", name: "", brand: "", model: "", serialNumber: "", itemNo: "", manufactured: "",
  condition: "Good", conditionNotes: "", ownership: "OWNED", fleetRef: "", toolboxId: "", notes: "",
};

type PlateReadingLike = {
  toolType: string; brand: string; model: string; serialNumber: string; itemNo: string; manufactured: string;
  specs: string; uncertainFields: string[]; conditionSuggestion: string; damage: string;
};

// `prefill` opens straight on the form with photos already taken - used for a
// tool sent in from site (its photos were read when it arrived).
export type RegisterPrefill = {
  platePhotoId: string | null;
  conditionPhotoId: string | null;
  reading: PlateReadingLike | null;
  toolboxId: string | null;
  note: string | null;
};

// Next free LOB-#### after the highest tag on the register.
async function nextTag() {
  const res = await apiFetch("/api/tools");
  const tools: { tag: string }[] = res.ok ? await res.json() : [];
  const max = tools.reduce((n, t) => Math.max(n, Number(t.tag.match(/LOB-(\d+)/)?.[1] ?? 0)), 0);
  return `LOB-${String(max + 1).padStart(4, "0")}`;
}

// Register a tool from two photos: the rating plate and the whole tool
// (condition / damage). The photos are read into a form that the person
// checks - fields the reading wasn't sure of are flagged - and nothing is
// saved until they press Save.
export default function RegisterByPhoto({
  onClose,
  onSaved,
  prefill,
  onCreated,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
  prefill?: RegisterPrefill;
  onCreated?: (toolId: string) => Promise<void>;
}) {
  const [plate, setPlate] = useState<string | null>(prefill?.platePhotoId ?? null);
  const [cond, setCond] = useState<string | null>(prefill?.conditionPhotoId ?? null);
  const [step, setStep] = useState<"photos" | "form">(prefill ? "form" : "photos");
  const [form, setForm] = useState<Form>(BLANK);
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState<{ tag: string; name: string } | null>(null);
  const [toolboxes, setToolboxes] = useState<ToolboxDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/toolboxes").then((r) => (r.ok ? r.json() : [])).then(setToolboxes);
  }, []);

  // Fill the form from a reading (fresh, or the one made when it came in from site).
  function applyReading(reading: PlateReadingLike, tag: string, extra: Partial<Form> = {}) {
    setForm({
      ...BLANK,
      tag,
      name: reading.toolType,
      brand: reading.brand,
      model: reading.model,
      serialNumber: reading.serialNumber,
      itemNo: reading.itemNo,
      manufactured: reading.manufactured,
      condition: reading.conditionSuggestion === "Unclear" ? "Good" : reading.conditionSuggestion,
      conditionNotes: reading.damage,
      notes: reading.specs,
      ...extra,
    });
    setUncertain([...reading.uncertainFields, ...(reading.serialNumber ? [] : ["serialNumber"])]);
  }

  useEffect(() => {
    if (!prefill) return;
    // Same duplicate-serial warning as reading photos in the office.
    const serial = (prefill.reading?.serialNumber ?? "").replace(/[\s\-./]/g, "").toUpperCase();
    if (serial) {
      apiFetch("/api/tools")
        .then((r) => (r.ok ? r.json() : []))
        .then((tools: { tag: string; name: string; serialNumber: string | null }[]) => {
          const dup = tools.find((t) => (t.serialNumber ?? "").replace(/[\s\-./]/g, "").toUpperCase() === serial);
          if (dup) setDuplicate({ tag: dup.tag, name: dup.name });
        });
    }
    nextTag().then((tag) => {
      const fromSite = prefill.note ? `From site: ${prefill.note}` : "";
      const extra: Partial<Form> = { toolboxId: prefill.toolboxId ?? "" };
      if (prefill.reading) {
        applyReading(prefill.reading, tag, { ...extra, notes: [prefill.reading.specs, fromSite].filter(Boolean).join("\n") });
      } else {
        setForm({ ...BLANK, ...extra, tag, notes: fromSite });
        setUncertain(["name", "brand", "model", "serialNumber"]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platePhotoId: plate, conditionPhotoId: cond }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't read the photos."));
      const { reading, suggestedTag, duplicate } = await res.json();
      applyReading(reading, suggestedTag);
      setDuplicate(duplicate);
      setStep("form");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fillByHand() {
    setForm({ ...BLANK, tag: await nextTag() });
    setStep("form");
  }

  async function save() {
    if (!form.tag.trim() || !form.name.trim()) return setError("Tag and what the tool is are required.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, photoIds: [plate, cond].filter(Boolean) }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save the tool."));
      const created = await res.json();
      if (onCreated) await onCreated(created.id);
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const field = (k: keyof Form, label: string, opts: { placeholder?: string; full?: boolean } = {}) => {
    const unsure = uncertain.includes(k);
    return (
      <label className={opts.full ? "col-span-2 block" : "block"}>
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-400">
          {label}
          {unsure && <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-500">check this</span>}
        </span>
        <input className={`${input} ${unsure ? "border-amber-500/70" : "border-edge"}`} value={form[k]} onChange={set(k)} placeholder={opts.placeholder} />
      </label>
    );
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="animate-modal-in max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-edge bg-panel p-5 shadow-soft-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-100">{prefill ? "Register a tool sent from site" : "Register a tool by photo"}</h2>
          <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {step === "photos" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <PhotoPicker kind="PLATE" label="1. Rating plate" hint="Close up, in focus, no glare. Take the battery off if the plate is under it." photoId={plate} onChange={setPlate} />
              <PhotoPicker kind="CONDITION" label="2. Whole tool (condition)" hint="The whole tool, showing any damage or wear." photoId={cond} onChange={setCond} />
            </div>
            {error && <div className="mt-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={fillByHand} className="text-xs text-gray-400 hover:text-gray-200 hover:underline">
                Fill in by hand instead
              </button>
              <button
                type="button"
                onClick={read}
                disabled={!plate || busy}
                className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
                {busy ? "Reading photos…" : "Read photos"}
              </button>
            </div>
          </>
        ) : (
          <>
            {prefill && (
              <div className="mb-3 flex gap-2">
                {[plate, cond].filter(Boolean).map((id) => (
                  <a key={id} href={`/api/tools/photos/${id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/tools/photos/${id}`} alt="Sent from site" className="h-24 w-24 rounded-md border border-edge object-cover" />
                  </a>
                ))}
              </div>
            )}
            {duplicate && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                This serial number is already registered as {duplicate.tag} ({duplicate.name}). Check before saving a second copy.
              </div>
            )}
            <p className="mb-3 text-xs text-gray-500">Check every field against the plate before saving. Fields marked “check this” weren&apos;t read with full confidence.</p>
            <div className="grid grid-cols-2 gap-3">
              {field("tag", "LOB tag (for its label)")}
              {field("name", "What it is", { placeholder: "e.g. Hammer drill driver" })}
              {field("brand", "Brand")}
              {field("model", "Model")}
              {field("serialNumber", "Serial number")}
              {field("itemNo", "Item no. (Hilti FFE)")}
              {field("manufactured", "Manufactured", { placeholder: "e.g. 06/2026" })}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-400">Condition</span>
                <select className={`${input} border-edge`} value={form.condition} onChange={set("condition")}>
                  {TOOL_CONDITIONS.filter((c) => c !== "Swapped out").map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              {field("conditionNotes", "Damage / wear seen", { full: true })}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-400">Ownership</span>
                <select className={`${input} border-edge`} value={form.ownership} onChange={set("ownership")}>
                  {TOOL_OWNERSHIP.map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
                </select>
              </label>
              {form.ownership === "HILTI_FLEET" ? field("fleetRef", "Hilti fleet reference") : <div />}
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-medium text-gray-400">Toolbox it belongs in</span>
                <select className={`${input} border-edge`} value={form.toolboxId} onChange={set("toolboxId")}>
                  <option value="">Yard (no toolbox yet)</option>
                  {toolboxes.map((b) => <option key={b.id} value={b.id}>{b.name}{b.supervisor ? ` — ${b.supervisor.name}` : ""}</option>)}
                </select>
              </label>
              {field("notes", "Notes / specs", { full: true })}
            </div>
            {error && <div className="mt-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
            <div className="mt-4 flex justify-between gap-2">
              {prefill ? (
                <span />
              ) : (
                <button type="button" onClick={() => setStep("photos")} className="text-xs text-gray-400 hover:text-gray-200 hover:underline">
                  ← Back to photos
                </button>
              )}
              <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
                {busy ? "Saving…" : "Save tool"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
