"use client";

// "Upload a batch of dockets" on /receipts (20 Nov 2026, Ilies: "we may upload a batch like from whats app"): pick the
// project, pick many photos, and they go up one at a time (3.5 MB each - bigger ones are shrunk here), each with its own progress; a failed one can be
// tried again. Each photo becomes a tip docket read like a phone-sent one; its job comes from the date read off it.
// The same photo twice is refused by the server; a docket number already in is flagged To check. Manager+.
import { useEffect, useRef, useState } from "react";
import ProjectSelect from "@/components/ProjectSelect";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { resizePhoto } from "@/lib/imageResize";
import { BATCH_LIMITS } from "@/lib/receipts/batchRules";
import type { PickerProject } from "@/lib/projectPicker";

type Item = { key: string; file: File; state: "waiting" | "sending" | "done" | "duplicate" | "failed"; note?: string };
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const btn = "rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const TONE: Record<Item["state"], string> = { waiting: "text-gray-400", sending: "text-sky-300", done: "text-emerald-300", duplicate: "text-amber-300", failed: "text-red-300" };
const WORD: Record<Item["state"], string> = { waiting: "Waiting", sending: "Sending...", done: "In - being read", duplicate: "Already in", failed: "Didn't go" };

const asDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("Couldn't open the file."));
  r.readAsDataURL(f);
});

// "None of this batch is asbestos" (Ilies, option b): sets not-asbestos on the batch's unanswered dockets only, kept
// with who and when; confirms nothing. Since DB-006 (23 Nov 2026) only on ones already read whose docket doesn't say
// asbestos - those, and ones not read yet, are left for a person. Also on each batch docket's row (ReceiptRow).
export function NoAsbestosButton({ batchId, onDone }: { batchId: string; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!confirm("None of the dockets in this batch are asbestos?\n\nDockets someone already answered stay as they are. Dockets that say asbestos, and ones not read yet, are left for you. Nothing is confirmed - each docket still needs confirming.")) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch(`/api/receipts/batches/${batchId}/no-asbestos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save."));
    const { changed = 0, leftAsbestos = 0, waiting = 0 } = await r.json();
    const s = (n: number) => (n === 1 ? "" : "s");
    onDone([
      `Not asbestos: ${changed} docket${s(changed)}.`,
      leftAsbestos > 0 && `${leftAsbestos} say${leftAsbestos === 1 ? "s" : ""} asbestos on the docket - answer ${leftAsbestos === 1 ? "that" : "those"} one by one.`,
      waiting > 0 && `${waiting} ${waiting === 1 ? "isn't" : "aren't"} read yet - press again once ${waiting === 1 ? "it's" : "they're"} read.`,
      "Each one still needs confirming.",
    ].filter(Boolean).join(" "));
  }
  return (
    <>
      <button className={quiet} disabled={busy} onClick={go}>None of this batch is asbestos</button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}

export default function DocketBatch({ onDone }: { onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [batch, setBatch] = useState<{ id: string; project: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !projects.length) apiFetch("/api/receipts?batchProjects=1").then(async (r) => r.ok && setProjects((await r.json()).projects));
  }, [open, projects.length]);

  function pickFiles(list: FileList | null) {
    setError(null);
    const all = [...(list ?? [])];
    const ok = all.filter((f) => TYPES.includes(f.type));
    const skipped = all.length - ok.length;
    const room = BATCH_LIMITS.photosPerBatch - items.filter((i) => i.state === "done").length;
    const take = ok.slice(0, Math.max(0, room));
    const notes = [skipped && `${skipped} file${skipped === 1 ? " isn't a photo" : "s aren't photos"} (JPEG, PNG or WebP) - left out.`, ok.length > take.length && `A batch holds ${BATCH_LIMITS.photosPerBatch} photos - the first ${take.length} are in; start another batch for the rest.`].filter(Boolean);
    if (notes.length) setError(notes.join(" "));
    setItems((xs) => [...xs.filter((x) => x.state === "done" || x.state === "duplicate"), ...take.map((file, n) => ({ key: `${Date.now()}-${n}-${file.name}`, file, state: "waiting" as const }))]);
  }

  async function sendOne(item: Item, batchId: string): Promise<Item> {
    try {
      let dataUrl = await asDataUrl(item.file);
      // Sent as it is (so the same photo is always the same bytes); only a photo over 3.5 MB is shrunk first (DB-004).
      if (item.file.size > BATCH_LIMITS.photoMaxBytes) dataUrl = await resizePhoto(item.file, 2400, 0.9);
      const r = await apiFetch(`/api/receipts/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) });
      if (r.ok) return { ...item, state: "done", note: undefined };
      const msg = await serverErrorMessage(r, "Couldn't send it.");
      if (r.status === 409 && /already in/.test(msg)) return { ...item, state: "duplicate", note: msg };
      return { ...item, state: "failed", note: msg };
    } catch (e) {
      return { ...item, state: "failed", note: e instanceof Error ? e.message : "Couldn't send it." };
    }
  }

  async function start() {
    setError(null);
    if (!batch && !projectId) return setError("Pick the project first.");
    setBusy(true);
    let b = batch;
    if (!b) {
      const r = await apiFetch("/api/receipts/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      if (!r.ok) { setBusy(false); return setError(await serverErrorMessage(r, "Couldn't start the batch.")); }
      b = await r.json();
      setBatch(b);
    }
    const queue = items.filter((i) => i.state === "waiting" || i.state === "failed");
    for (const item of queue) {
      setItems((xs) => xs.map((x) => (x.key === item.key ? { ...x, state: "sending" } : x)));
      const out = await sendOne(item, b!.id);
      setItems((xs) => xs.map((x) => (x.key === item.key ? out : x)));
      if (out.state === "failed" && /most photos|holds at most|closed/.test(out.note ?? "")) break; // a cap - the rest would fail too
    }
    setBusy(false);
    onDone("Batch uploaded - the dockets are being read; anything unclear will be under Check these.");
  }

  function reset() { setBatch(null); setItems([]); setProjectId(""); setError(null); if (fileRef.current) fileRef.current.value = ""; }

  if (!open) return <button className={quiet} onClick={() => setOpen(true)}>Upload a batch of dockets</button>;
  const counts = Object.fromEntries((["waiting", "sending", "done", "duplicate", "failed"] as const).map((s) => [s, items.filter((i) => i.state === s).length]));
  return (
    <div className="mb-4 w-full rounded-xl border border-edge bg-panel p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-gray-100">Upload a batch of dockets</span>
        <button className="text-xs text-gray-400 hover:text-gray-200" disabled={busy} onClick={() => { reset(); setOpen(false); }}>Close</button>
      </div>
      <p className="mb-2 text-xs text-gray-400">
        Tip-docket photos for one project (e.g. from a WhatsApp group). Each one is read like a docket sent from a phone; its job comes from the date on it.
        Asbestos is asked on each docket when you confirm it. The same photo twice is skipped; a docket number already in waits under Check these.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {batch ? <span className="text-xs text-gray-300">Project: <b>{batch.project}</b></span> : (
          <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} noneLabel="Which project?" ariaLabel="Project"
            className="rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200" />
        )}
        <input ref={fileRef} type="file" accept={TYPES.join(",")} multiple disabled={busy} onChange={(e) => pickFiles(e.target.files)} className="text-xs text-gray-300" aria-label="Docket photos" />
        <button className={btn} disabled={busy || !items.some((i) => i.state === "waiting" || i.state === "failed")} onClick={start}>
          {busy ? "Uploading..." : counts.failed && !counts.waiting ? `Try the ${counts.failed} again` : `Upload ${counts.waiting + counts.failed || ""} photo${counts.waiting + counts.failed === 1 ? "" : "s"}`}
        </button>
        {batch && !busy && counts.done > 0 && <NoAsbestosButton batchId={batch.id} onDone={onDone} />}
        {batch && !busy && <button className={quiet} onClick={reset}>New batch</button>}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {items.length > 0 && (
        <>
          <p className="mt-2 text-xs text-gray-400">{counts.done} in · {counts.duplicate} already in · {counts.failed} didn&apos;t go · {counts.waiting + counts.sending} to go</p>
          <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-edge/60">
            {items.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-2 border-b border-edge/40 px-2 py-1 text-xs last:border-0">
                <span className="min-w-0 flex-1 truncate text-gray-300">{i.file.name}</span>
                <span className={TONE[i.state]}>{WORD[i.state]}</span>
                {i.note && <span className="w-full text-[11px] text-gray-500">{i.note}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
