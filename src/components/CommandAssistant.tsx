"use client";

import { useRef, useState } from "react";
import { Bot, Check, LoaderCircle, Mic, Square, X } from "lucide-react";
import { DragResourcePayload, JobDTO, ResourceDTO } from "@/lib/types";
import { columnFor } from "@/lib/resource";
import { JobMatch, PersonMatch, matchJob, matchPeople } from "@/lib/matchCommand";

// A floating voice-command shortcut for the Command Centre board only - "send
// Joao and Sam to Mt Hutton" does what dragging their tiles onto that job row
// would do. Record -> transcribe (OpenAI) -> extract names/job (Claude, one
// bounded call, no tools, no DB access) -> match against the resources/jobs
// already loaded on this page (plain string matching, see matchCommand.ts) ->
// show exactly who/where before touching anything -> on confirm, call the
// same onAssign the board's own drag-and-drop uses, once per person. Nothing
// here bypasses the normal assignment API, its role check or its day-lock.
const MAX_RECORD_MS = 20000;

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "transcribing" }
  | { kind: "interpreting"; transcript: string }
  | { kind: "confirm"; transcript: string; jobName: string; people: PersonMatch[]; job: JobMatch }
  | { kind: "assigning" }
  | { kind: "done"; summary: string }
  | { kind: "error"; message: string };

// A transcription-prompt hint built from this page's own data - every active
// crew/plant name and every job/site currently on the board, so the ASR
// model has the actual proper nouns it needs to spell "Joao" or "Abdulkadir"
// right instead of guessing from sound alone. Crew names come first (the
// motivating problem - see the file header); plant/site names are padding
// that gets truncated server-side first if the list runs long.
function buildVocabulary(resources: ResourceDTO[], boardRows: JobDTO[]): string {
  const active = resources.filter((r) => r.active);
  const personnel = active.filter((r) => r.type === "PERSONNEL" || r.type === "HIRE").map((r) => r.name);
  const plant = active
    .filter((r) => r.type !== "PERSONNEL" && r.type !== "HIRE")
    .map((r) => r.name);
  const jobs = Array.from(new Set(boardRows.map((j) => j.title)));
  return [...personnel, ...jobs, ...plant].join(", ");
}

export default function CommandAssistant({
  resources,
  boardRows,
  onAssign,
}: {
  resources: ResourceDTO[];
  boardRows: JobDTO[];
  onAssign: (jobId: string, payload: DragResourcePayload) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // spoken name -> chosen resourceId (null = skipped/unresolved)
  const [personPick, setPersonPick] = useState<Record<string, string | null>>({});
  const [jobPick, setJobPick] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setPhase({ kind: "idle" });
    setPersonPick({});
    setJobPick(null);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void handleStopped(mr.mimeType || "audio/webm");
      };
      recorderRef.current = mr;
      mr.start();
      setPhase({ kind: "recording" });
      autoStopRef.current = setTimeout(stopRecording, MAX_RECORD_MS);
    } catch {
      setPhase({
        kind: "error",
        message: "Couldn't access the microphone - check the browser's mic permission for this site.",
      });
    }
  }

  function stopRecording() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    recorderRef.current?.stop();
  }

  async function handleStopped(mimeType: string) {
    setPhase({ kind: "transcribing" });
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const form = new FormData();
    form.append("audio", blob, "command.webm");
    form.append("vocabulary", buildVocabulary(resources, boardRows));
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPhase({ kind: "error", message: body?.error || "Couldn't transcribe that. Try again." });
        return;
      }
      const text = (body?.text || "").trim();
      if (!text) {
        setPhase({ kind: "error", message: "Didn't hear anything there - try again." });
        return;
      }
      await interpret(text);
    } catch {
      setPhase({ kind: "error", message: "Couldn't transcribe that. Try again." });
    }
  }

  async function interpret(transcript: string) {
    setPhase({ kind: "interpreting", transcript });
    try {
      const res = await fetch("/api/assistant/parse-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPhase({ kind: "error", message: body?.error || "Couldn't understand that. Try again." });
        return;
      }
      const spokenPeople: string[] = body?.people ?? [];
      const jobName: string = body?.jobName ?? "";
      if (!spokenPeople.length || !jobName) {
        setPhase({ kind: "error", message: `Didn't catch an assignment in "${transcript}" - try again.` });
        return;
      }
      const people = matchPeople(spokenPeople, resources);
      const job = matchJob(jobName, boardRows);
      setPersonPick(
        Object.fromEntries(people.map((p) => [p.spoken, p.matches.length === 1 ? p.matches[0].id : null]))
      );
      setJobPick(job.jobs.length === 1 ? job.jobs[0].id : null);
      setPhase({ kind: "confirm", transcript, jobName, people, job });
    } catch {
      setPhase({ kind: "error", message: "Couldn't understand that. Try again." });
    }
  }

  async function confirm() {
    if (phase.kind !== "confirm" || !jobPick) return;
    setPhase({ kind: "assigning" });
    const names: string[] = [];
    for (const p of phase.people) {
      const resourceId = personPick[p.spoken];
      if (!resourceId) continue;
      const resource = resources.find((r) => r.id === resourceId);
      if (!resource) continue;
      const payload: DragResourcePayload = {
        resourceId: resource.id,
        resourceName: resource.name,
        column: columnFor(resource),
      };
      await onAssign(jobPick, payload);
      names.push(resource.name);
    }
    const job = boardRows.find((j) => j.id === jobPick);
    setPhase({
      kind: "done",
      summary: names.length
        ? `Assigned ${names.join(", ")} to ${job?.title ?? "the job"}.`
        : "Nothing to assign - everyone was skipped.",
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          reset();
        }}
        title="Voice command: assign crew by saying it instead of dragging"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-soft-lg hover:bg-brand-500 active:scale-[0.96]"
      >
        <Bot size={24} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 w-80 overflow-hidden rounded-2xl border border-edge bg-panel shadow-soft-lg">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-100">
          <Bot size={16} className="text-brand-600" />
          Voice assign
        </div>
        <button
          onClick={() => {
            if (phase.kind === "recording") stopRecording();
            setOpen(false);
          }}
          className="text-gray-500 hover:text-gray-300"
        >
          <X size={16} />
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto p-4">
        {phase.kind === "idle" && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <p className="text-xs text-gray-500">
              Press record and say something like &ldquo;send Joao and Sam to Mt Hutton&rdquo;.
            </p>
            <button
              onClick={startRecording}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-500"
            >
              <Mic size={20} />
            </button>
          </div>
        )}

        {phase.kind === "recording" && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <p className="flex items-center gap-1.5 text-xs font-medium text-red-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              Listening...
            </p>
            <button
              onClick={stopRecording}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
            >
              <Square size={18} />
            </button>
          </div>
        )}

        {(phase.kind === "transcribing" || phase.kind === "interpreting" || phase.kind === "assigning") && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <LoaderCircle size={20} className="animate-spin text-brand-600" />
            <p className="text-xs text-gray-500">
              {phase.kind === "transcribing"
                ? "Transcribing..."
                : phase.kind === "interpreting"
                ? `"${phase.transcript}"`
                : "Assigning..."}
            </p>
          </div>
        )}

        {phase.kind === "confirm" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs italic text-gray-500">&ldquo;{phase.transcript}&rdquo;</p>

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Job</div>
              {phase.job.jobs.length === 0 && (
                <p className="text-xs text-red-400">Couldn&apos;t find a job matching &ldquo;{phase.jobName}&rdquo;.</p>
              )}
              {phase.job.jobs.length === 1 && (
                <p className="text-xs font-medium text-emerald-400">{phase.job.jobs[0].title}</p>
              )}
              {phase.job.jobs.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {phase.job.jobs.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => setJobPick(j.id)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        jobPick === j.id
                          ? "border-brand-500 bg-brand-500/15 text-brand-600"
                          : "border-edge text-gray-400 hover:bg-panel2"
                      }`}
                    >
                      {j.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">People</div>
              <div className="flex flex-col gap-1.5">
                {phase.people.map((p) => (
                  <div key={p.spoken} className="text-xs">
                    <span className="text-gray-500">&ldquo;{p.spoken}&rdquo; </span>
                    {p.matches.length === 0 && <span className="text-red-400">- not found, skipped</span>}
                    {p.matches.length === 1 && (
                      <span className="font-medium text-emerald-400">→ {p.matches[0].name}</span>
                    )}
                    {p.matches.length > 1 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {p.matches.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => setPersonPick((s) => ({ ...s, [p.spoken]: r.id }))}
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${
                              personPick[p.spoken] === r.id
                                ? "border-brand-500 bg-brand-500/15 text-brand-600"
                                : "border-edge text-gray-400 hover:bg-panel2"
                            }`}
                          >
                            {r.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={reset}
                className="flex-1 rounded-lg border border-edge py-1.5 text-xs font-medium text-gray-300 hover:bg-panel2"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={!jobPick || Object.values(personPick).every((v) => !v)}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check size={13} />
                Confirm
              </button>
            </div>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <Check size={20} className="text-emerald-400" />
            <p className="text-xs text-gray-300">{phase.summary}</p>
            <button onClick={reset} className="mt-1 text-[11px] font-medium text-brand-600 hover:underline">
              New command
            </button>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <p className="text-xs text-red-400">{phase.message}</p>
            <button onClick={reset} className="mt-1 text-[11px] font-medium text-brand-600 hover:underline">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
