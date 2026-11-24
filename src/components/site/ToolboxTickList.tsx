"use client";

// "Check my toolbox" on a supervisor's link as a tick list (Ilies, 25 Nov 2026: "List + tick each one"). One section
// per toolbox: every tool with Here / Missing, nothing pre-selected, "Mark all here" as a shortcut, and "Check toolbox"
// only once every tool is marked. Saved as the same ToolboxCheck a photo check makes (POST .../submit TICK_CHECK).
// The photo check stays one tap away ("Use photos instead"). Rules in lib/toolboxTick.ts.
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import CheckResultView from "@/components/tools/CheckResultView";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { CheckResult } from "@/lib/toolboxCheck";
import { EMPTY_TOOLBOX, canSendTick, markAllHere, markedLabel, tickListView, type TickBox, type TickMark, type TickMarks } from "@/lib/toolboxTick";

const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";

async function send(api: string, body: Record<string, unknown>) {
  const res = await fetch(`${api}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
  return res.json();
}

export default function ToolboxTickList({ api, toolboxes, onUsePhotos }: { api: string; toolboxes: TickBox[]; onUsePhotos: () => void }) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-100">Check my toolbox</h1>
      {toolboxes.length === 0 && <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-300">{EMPTY_TOOLBOX}</p>}
      {toolboxes.map((b) => <TickSection key={b.id} api={api} box={b} />)}
      <button type="button" className="w-full py-2 text-sm text-gray-400 underline" onClick={onUsePhotos}>Use photos instead</button>
    </div>
  );
}

function TickSection({ api, box }: { api: string; box: TickBox }) {
  const view = tickListView(box);
  const [marks, setMarks] = useState<Partial<TickMarks>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const mark = (id: string, m: TickMark) => setMarks((x) => ({ ...x, [id]: m }));

  if (result) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-100">{view.name}</h2>
        <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">
          ✓ Checked - {result.present.length} here{result.missing.length ? `, ${result.missing.length} missing` : ""}.
        </div>
        {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
        <CheckResultView
          result={result}
          boxName={view.name}
          done={done}
          onMissing={async (toolId) => {
            setError(null);
            try {
              const r = await send(api, { kind: "CHECK_ACTION", action: "MISSING", toolId, toolboxId: view.id });
              setDone((d) => ({ ...d, [toolId]: r.message }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
        <button className={primary} onClick={() => { setResult(null); setMarks({}); setDone({}); }}>Check again</button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-100">{view.heading}</h2>
      {view.tools.length === 0 ? (
        <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-300">{EMPTY_TOOLBOX}</p>
      ) : (
        <>
          <button
            type="button"
            className="w-full rounded-xl border border-edge px-4 py-3 text-base font-medium text-gray-200 active:scale-[0.99]"
            onClick={() => setMarks(markAllHere(view.tools))}
          >
            Mark all here
          </button>
          <ul className="space-y-2">
            {view.tools.map((t) => {
              const m = marks[t.id];
              return (
                <li key={t.id} className="rounded-2xl border border-edge bg-panel p-3">
                  <div className="mb-2 min-w-0">
                    <div className="text-base font-semibold text-gray-100">{t.name}</div>
                    <div className="text-sm text-gray-500">{t.tag}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      aria-pressed={m === "HERE"}
                      onClick={() => mark(t.id, "HERE")}
                      className={`flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border text-base font-semibold ${m === "HERE" ? "border-emerald-500 bg-emerald-600 text-white" : "border-edge bg-panel2 text-gray-300"}`}
                    >
                      <Check size={18} /> Here
                    </button>
                    <button
                      type="button"
                      aria-pressed={m === "MISSING"}
                      onClick={() => mark(t.id, "MISSING")}
                      className={`flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border text-base font-semibold ${m === "MISSING" ? "border-red-500 bg-red-600 text-white" : "border-edge bg-panel2 text-gray-300"}`}
                    >
                      <X size={18} /> Missing
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-center text-sm text-gray-400">{markedLabel(view.tools, marks)}</p>
          {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
          <button
            className={primary}
            disabled={busy || !canSendTick(view.tools, marks)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await send(api, { kind: "TICK_CHECK", toolboxId: view.id, marks });
                setResult(r.result);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 size={18} className="animate-spin" />} {busy ? "Sending…" : "Check toolbox"}
          </button>
        </>
      )}
    </section>
  );
}
