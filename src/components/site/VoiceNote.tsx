"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Plus, Square } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { DelayCode } from "@/lib/dailyLog/rules";
// The words shown when it couldn't be turned into text (the lead, 29 Oct 2026). Whatever was typed stays as it was.
const FAILED_TO_TEXT = "Couldn't turn that into text - try again or type it.";

// Voice entry on the daily log (29 Oct 2026, Ilies "go"): one big button (works with gloves) to talk through the
// day - up to 2 minutes with a timer and a Stop button. The server turns it into clean written notes and suggested
// delays; the supervisor edits the text and TAPS to use it, and taps each delay to add it. Nothing goes in the log
// without a tap, and Send is the normal one. The recording is only ever in this page's memory and the server's,
// and is gone once it's text. Typing always works.

type Reply = {
  voiceId: string; note: string; checkThis: string[]; amountsNotice: string | null;
  delays: { delayCode: DelayCode; label: string; hoursLost: number | null; note: string }[];
};
// 5 minutes (29 Oct 2026, Ilies: "the guys will have a lot to say"): a warning at 4:30, then it stops and sends
// itself at 5:00 so nothing is lost.
const MAX_SECONDS = 300;
const WARN_AT = 270;
// Chrome / Android record webm; an iPhone records mp4 - whichever this phone can do.
const pickMime = () => {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function VoiceNote({ api, jobId, onUseNote, onAddDelay }: {
  api: string; jobId: string;
  onUseNote: (text: string, voiceId: string) => string | null; // a reason it couldn't be added, or null
  onAddDelay: (d: { delayCode: DelayCode; hoursLost: number | null; note: string }) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "working" | "review">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [text, setText] = useState("");
  const [used, setUsed] = useState(false);
  const [added, setAdded] = useState<number[]>([]);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    setError(null);
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) return setError("This phone can't record here - type it instead.");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return setError("The microphone is blocked - allow it in the browser, or type it instead."); }
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); send(new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" })); };
    rec.current = r;
    r.start();
    startedAt.current = Date.now();
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
  }
  function stop() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (rec.current?.state === "recording") rec.current.stop();
  }
  async function send(audio: Blob) {
    setState("working");
    const form = new FormData();
    form.append("audio", audio, "log");
    // Which job and how long go in the address, so the server can check them before reading the recording (SEC-003).
    const secs = Math.max(1, Math.min(MAX_SECONDS, Math.round((Date.now() - startedAt.current) / 1000)));
    chunks.current = []; // the recording leaves this page's memory once sent
    const res = await fetch(`${api}/log/voice?jobId=${encodeURIComponent(jobId)}&seconds=${secs}`, { method: "POST", body: form }).catch(() => null);
    if (!res || !res.ok) {
      setState("idle");
      // The limit, voice off, too long, a format: their own words. Anything else failing: the plain line.
      if (res && [403, 413, 415, 429, 503].includes(res.status)) return setError(await serverErrorMessage(res, FAILED_TO_TEXT));
      return setError(res ? FAILED_TO_TEXT : "Couldn't send it - check your signal, or type it.");
    }
    const r: Reply = await res.json();
    setReply(r); setText(r.note); setUsed(false); setAdded([]); setState("review");
  }

  if (state === "idle") {
    return (
      <div className="mb-4">
        <button onClick={start} className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-brand-500 bg-brand-600/20 px-4 py-4 text-lg font-semibold text-brand-100 active:bg-brand-600/40">
          <Mic size={28} /> Talk through your day
        </button>
        <p className="mt-1 text-center text-xs text-gray-500">Up to 5 minutes - record again to add more. You&apos;ll see it written out to check before anything goes in.</p>
        <p className="mt-0.5 text-center text-[11px] text-gray-500">Your recording is sent to OpenAI and Anthropic to write it out. The recording itself isn&apos;t kept.</p>
        {error && <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      </div>
    );
  }
  if (state === "recording") {
    return (
      <div className="mb-4 rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-4 text-center">
        <p className="text-sm text-red-200"><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />Recording · {clock(seconds)} of {clock(MAX_SECONDS)}</p>
        {seconds >= WARN_AT && <p className="mt-1 text-sm font-semibold text-amber-300">30 seconds left - it stops and sends itself at 5:00.</p>}
        <button onClick={stop} className="mx-auto mt-3 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-red-600 px-4 py-4 text-lg font-semibold text-white">
          <Square size={24} /> Stop
        </button>
      </div>
    );
  }
  if (state === "working") {
    return <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-edge bg-panel p-5 text-gray-300"><Loader2 className="animate-spin" /> Working on it… (a long one can take a minute)</div>;
  }
  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-brand-500/50 bg-panel p-4">
      <p className="text-sm font-semibold text-gray-100">Here&apos;s what you said, written out - check it</p>
      {reply?.amountsNotice && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{reply.amountsNotice}</p>}
      <textarea className="w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200" rows={8} value={text} onChange={(e) => { setText(e.target.value); setUsed(false); }} />
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {reply && reply.checkThis.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <p className="font-semibold">Check this</p>
          <ul className="ml-4 list-disc">{reply.checkThis.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <button disabled={!text.trim() || used} onClick={() => { const why = onUseNote(text.trim(), reply!.voiceId); if (why) setError(why); else { setError(null); setUsed(true); } }}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50">
        {used ? "In your note ✓" : "Use this as my note"}
      </button>
      {reply && reply.delays.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">Hold-ups you mentioned - tap to add:</p>
          {reply.delays.map((d, i) => (
            <button key={i} disabled={added.includes(i)} onClick={() => { onAddDelay({ delayCode: d.delayCode, hoursLost: d.hoursLost, note: d.note }); setAdded([...added, i]); }}
              className="flex w-full items-center gap-2 rounded-xl border border-edge bg-panel2 px-3 py-3 text-left text-sm text-gray-200 disabled:opacity-60">
              <Plus size={16} /> <span className="font-semibold">{d.label}</span>{d.hoursLost != null ? ` · ${d.hoursLost} h` : ""}{d.note ? ` · ${d.note}` : ""}
              {added.includes(i) && <span className="ml-auto text-emerald-300">Added ✓</span>}
            </button>
          ))}
        </div>
      )}
      <button onClick={() => { setState("idle"); setReply(null); }} className="w-full rounded-xl border border-edge px-4 py-2.5 text-sm text-gray-300">Record again</button>
    </div>
  );
}
