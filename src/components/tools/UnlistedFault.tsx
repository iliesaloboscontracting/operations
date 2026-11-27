"use client";

// A fault a supervisor sent as "Not in the list" (Ilies, 27 Nov 2026 - "the photo reader suggests the tool and the
// office confirms"), on From site. Shows what the photo reader saw (untrusted text, shown as plain text only) and the
// likely tools from the register (plain-code matching, lib/toolFaults.ts). Nothing is linked until a person picks the
// tool and presses Log fault - or adds the tool to the register with the existing Register by photo form.
import { useState } from "react";
import type { RegisterPrefill } from "@/components/tools/RegisterByPhoto";
import { HOW_LABEL, type FaultPhotoSeen, type Suggestion } from "@/lib/toolFaults";
import type { ToolDTO } from "@/lib/types";

const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

type Info = { status: "WAITING" | "READ" | "NOT_READ"; reason: string | null; seen: FaultPhotoSeen | null; suggestions: Suggestion[] };

// The Register by photo form, filled from the fault's photo and reading. Every field is marked "check this" - the
// reading came from a site photo and nobody in the office has checked it yet.
export function unlistedPrefill(photoId: string | null, seen: FaultPhotoSeen | null, description: string | null): RegisterPrefill {
  return {
    platePhotoId: null,
    conditionPhotoId: photoId,
    reading: seen
      ? {
          toolType: seen.toolType, brand: seen.brand, model: seen.model, serialNumber: seen.serialNumber, itemNo: "", manufactured: "", specs: "",
          uncertainFields: ["toolType", "brand", "model", "serialNumber"], conditionSuggestion: "Needs repair", damage: seen.damage,
        }
      : null,
    toolboxId: null,
    note: description ? `Fault reported from site: ${description}` : null,
  };
}

export default function UnlistedFault({
  description,
  info,
  tools,
  canEdit,
  onLog,
  onAddTool,
}: {
  description: string | null;
  info: Info;
  tools: ToolDTO[];
  canEdit: boolean;
  onLog: (toolId: string) => Promise<unknown>;
  onAddTool: () => void;
}) {
  const [toolId, setToolId] = useState(info.suggestions[0]?.toolId ?? "");
  const [busy, setBusy] = useState(false);
  const s = info.seen;
  const seenLine = s ? [s.toolType, [s.brand, s.model].filter(Boolean).join(" ")].filter(Boolean).join(" - ") : "";
  const suggested = new Set(info.suggestions.map((x) => x.toolId));
  return (
    <div className="space-y-2">
      <div>{description}</div>
      <div className="rounded-lg border border-edge bg-panel2 px-3 py-2 text-xs">
        <div className="mb-0.5 font-semibold text-gray-300">What the photo shows</div>
        {info.status === "WAITING" ? (
          <div className="text-gray-400">Reading the photo… refresh in a moment.</div>
        ) : info.status === "NOT_READ" || !s ? (
          <div className="text-gray-400">{info.reason ?? "Not read"} </div>
        ) : (
          <div className="space-y-0.5 text-gray-300">
            <div>{seenLine || "Couldn't tell what tool it is"}</div>
            {(s.lobTag || s.serialNumber) && (
              <div className="text-gray-400">
                {s.lobTag && <>Tag <span className="font-mono">{s.lobTag}</span> </>}
                {s.serialNumber && <>Serial <span className="font-mono">{s.serialNumber}</span></>}
              </div>
            )}
            {s.damage && <div className="text-amber-500">Damage: {s.damage}</div>}
            <div className="text-[11px] text-gray-500">Read from the photo by the photo reader - check it against the photo.</div>
          </div>
        )}
      </div>
      {info.suggestions.length > 0 && (
        <div className="text-xs">
          <div className="mb-1 font-semibold text-gray-300">Likely tools on the register</div>
          <div className="flex flex-wrap gap-1.5">
            {info.suggestions.map((x) => (
              <button
                key={x.toolId}
                type="button"
                className={`rounded-full border px-2.5 py-1 ${toolId === x.toolId ? "border-brand-500 bg-brand-600/20 text-gray-100" : "border-edge text-gray-300 hover:bg-panel2"}`}
                onClick={() => setToolId(x.toolId)}
              >
                <span className="font-mono">{x.tag}</span> {x.name}
                <span className="text-gray-500"> · {x.toolboxName ?? "Yard"} · {HOW_LABEL[x.how]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {info.status === "READ" && info.suggestions.length === 0 && <div className="text-xs text-gray-400">No likely tool on the register - pick it below, or add it.</div>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select
            className="w-full min-w-0 rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200 sm:w-auto sm:min-w-[16rem] sm:flex-1"
            value={toolId}
            onChange={(e) => setToolId(e.target.value)}
            aria-label="Which tool is it?"
          >
            <option value="">Which tool is it?</option>
            {info.suggestions.length > 0 && (
              <optgroup label="Likely">
                {info.suggestions.map((x) => <option key={x.toolId} value={x.toolId}>{x.tag} · {x.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Every tool">
              {tools.filter((t) => !suggested.has(t.id)).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tag} · {t.name}{t.serialNumber ? ` · ${t.serialNumber}` : ""} ({t.toolbox?.name ?? "Yard"})
                </option>
              ))}
            </optgroup>
          </select>
          <button
            className={btn}
            disabled={!toolId || busy}
            onClick={async () => {
              setBusy(true);
              await onLog(toolId);
              setBusy(false);
            }}
          >
            Log fault on this tool (marks Needs repair)
          </button>
          <button className={quiet} onClick={onAddTool}>Not on the register - add it</button>
        </div>
      )}
    </div>
  );
}
