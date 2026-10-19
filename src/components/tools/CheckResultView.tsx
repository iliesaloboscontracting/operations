"use client";

import { CheckCircle2, HelpCircle, ShieldAlert, XCircle } from "lucide-react";
import type { CheckResult } from "@/lib/toolboxCheck";

const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

function Row({ icon, tone, children }: { icon: React.ReactNode; tone: string; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

// The result of a toolbox photo check. Used on the office Toolboxes page and on
// a supervisor's Site photos page. `done` holds the outcome text for tools
// already actioned; without onMine/onMissing the result is read-only.
export default function CheckResultView({
  result,
  boxName,
  done = {},
  onMine,
  onMissing,
  onSendBack,
}: {
  result: CheckResult;
  boxName: string;
  done?: Record<string, string>;
  onMine?: (toolId: string) => void;
  onMissing?: (toolId: string) => void;
  onSendBack?: (toolId: string, belongsTo: string | null | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      {result.foreign.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500">From another toolbox ({result.foreign.length})</h3>
          <ul className="space-y-1">
            {result.foreign.map((t) => (
              <Row key={t.toolId} icon={<ShieldAlert size={14} className="text-amber-500" />} tone="bg-amber-500/10">
                <div className="text-gray-100">
                  {t.tag} · {t.name} {t.serialNumber && <span className="font-mono text-gray-400">({t.serialNumber})</span>}
                </div>
                <div className="text-amber-500">Belongs in {t.belongsTo ?? "the yard"} (identified by {t.how === "tag" ? "LOB tag" : "serial number"})</div>
                {done[t.toolId] ? (
                  <div className="mt-1 text-gray-400">✓ {done[t.toolId]}</div>
                ) : (
                  (onMine || onSendBack) && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {onSendBack && <button type="button" className={quiet} onClick={() => onSendBack(t.toolId, t.belongsTo)}>Send it back</button>}
                      {onMine && <button type="button" className={btn} onClick={() => onMine(t.toolId)}>Keep it - move to {boxName}</button>}
                    </div>
                  )
                )}
              </Row>
            ))}
          </ul>
        </section>
      )}
      {result.missing.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-400">Not seen ({result.missing.length})</h3>
          <ul className="space-y-1">
            {result.missing.map((t) => (
              <Row key={t.toolId} icon={<XCircle size={14} className="text-red-400" />} tone="bg-red-900/20">
                <div className="text-gray-100">
                  {t.tag} · {t.name} {t.serialNumber && <span className="font-mono text-gray-400">({t.serialNumber})</span>}
                </div>
                {done[t.toolId] ? (
                  <div className="mt-1 text-gray-400">✓ {done[t.toolId]}</div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-gray-400">Not in the photo - could be in use or its label was hidden.</span>
                    {onMissing && <button type="button" className={quiet} onClick={() => onMissing(t.toolId)}>Mark missing</button>}
                  </div>
                )}
              </Row>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-400">
          In the right toolbox ({result.present.length + result.presentUnconfirmed.length})
        </h3>
        <ul className="space-y-1">
          {result.present.map((t) => (
            <Row key={t.toolId} icon={<CheckCircle2 size={14} className="text-emerald-400" />} tone="">
              {t.tag} · {t.name} <span className="text-gray-500">— by {t.how === "tag" ? "LOB tag" : "serial number"}</span>
            </Row>
          ))}
          {result.presentUnconfirmed.map((t) => (
            <Row key={t.toolId} icon={<CheckCircle2 size={14} className="text-gray-400" />} tone="">
              {t.tag} · {t.name} <span className="text-amber-500">— probably (same model seen, no tag or serial readable)</span>
            </Row>
          ))}
          {result.present.length + result.presentUnconfirmed.length === 0 && <li className="text-xs text-gray-500">None identified.</li>}
        </ul>
      </section>
      {result.unknown.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Not on the register ({result.unknown.length})</h3>
          <ul className="space-y-1">
            {result.unknown.map((u, i) => (
              <Row key={i} icon={<HelpCircle size={14} className="text-gray-400" />} tone="">
                {u.description}
                {(u.brand || u.model) && <span className="text-gray-500"> · {[u.brand, u.model].filter(Boolean).join(" ")}</span>}
                {u.lobTag && <span className="text-gray-500"> · tag {u.lobTag}</span>}
                {u.possibly.length > 0 && <div className="text-gray-500">Same model is registered in: {u.possibly.join(", ")}</div>}
              </Row>
            ))}
          </ul>
        </section>
      )}
      {result.notes && <p className="text-xs text-gray-500">Note from the check: {result.notes}</p>}
    </div>
  );
}
