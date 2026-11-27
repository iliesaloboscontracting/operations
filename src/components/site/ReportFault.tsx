"use client";

// Report a fault from a supervisor's link (Ilies, 27 Nov 2026 - "Any tool, plus 'not in the list'": "Their toolbox
// first, then every other Lobos tool, plus 'Not in the list' with a photo"). The picker lists the supervisor's own
// toolbox(es) as before, then every other Lobos tool (tag + name only, from /api/site/:token/fault-tools), then "Not in
// the list", which needs a photo - the office finds the tool from it. A search box narrows the list on a phone.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import { serverErrorMessage } from "@/lib/apiFetch";
import { UNLISTED, filterGroups, type PickerGroup } from "@/lib/toolFaults";

type OwnTool = { id: string; tag: string; name: string; serialNumber: string | null };
type OwnBox = { id: string; name: string; tools: OwnTool[] };

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";

export default function ReportFault({
  api,
  toolboxes,
  post,
  onDone,
}: {
  api: string;
  toolboxes: OwnBox[];
  post: (api: string, body: Record<string, unknown>) => Promise<{ message: string }>;
  onDone: (m: string) => void;
}) {
  const [toolId, setToolId] = useState("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [others, setOthers] = useState<PickerGroup[] | null>(null);
  const [othersError, setOthersError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${api}/fault-tools`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await serverErrorMessage(r, "The other tools didn't load.")))))
      .then((j: { groups: PickerGroup[] }) => live && setOthers(j.groups ?? []))
      .catch((e: Error) => live && setOthersError(e.message));
    return () => {
      live = false;
    };
  }, [api]);

  const ownCount = toolboxes.reduce((n, b) => n + b.tools.length, 0);
  const own = useMemo(() => filterGroups(toolboxes, q), [toolboxes, q]);
  const rest = useMemo(() => filterGroups(others ?? [], q), [others, q]);
  const shown = own.reduce((n, b) => n + b.tools.length, 0) + rest.reduce((n, g) => n + g.tools.length, 0);
  // What's picked, in words - so it stays clear even when the search hides it from the list.
  const picked = useMemo(() => {
    if (!toolId || toolId === UNLISTED) return null;
    for (const b of toolboxes) for (const t of b.tools) if (t.id === toolId) return `${t.tag} · ${t.name}`;
    for (const g of others ?? []) for (const t of g.tools) if (t.id === toolId) return `${t.tag} · ${t.name} (${g.name})`;
    return null;
  }, [toolId, toolboxes, others]);
  const unlisted = toolId === UNLISTED;
  const visible = (id: string) => own.some((b) => b.tools.some((t) => t.id === id)) || rest.some((g) => g.tools.some((t) => t.id === id));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Report a fault</h1>
      {ownCount === 0 && (
        <p className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-gray-400">
          {toolboxes.length === 0 ? "You don't have a toolbox on the register" : "Your toolbox has no tools on the register yet"} - pick from the other
          Lobos tools, or &quot;Not in the list&quot; and send a photo.
        </p>
      )}
      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input className={`${input} pl-9`} type="search" inputMode="search" placeholder="Search tag or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tools" />
      </label>
      <div>
        <select className={input} value={toolId} onChange={(e) => setToolId(e.target.value)} aria-label="Which tool?">
          <option value="">{q.trim() ? `Which tool? (${shown} match${shown === 1 ? "" : "es"})` : "Which tool?"}</option>
          {/* Keep the picked tool selectable while a search hides it. */}
          {picked && !visible(toolId) && <option value={toolId}>{picked}</option>}
          {own.map((b) => (
            <optgroup key={b.id} label={`Your toolbox - ${b.name}`}>
              {b.tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tag} · {t.name}{t.serialNumber ? ` · ${t.serialNumber}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
          {rest.map((g) => (
            <optgroup key={g.name} label={`Other Lobos tools - ${g.name}`}>
              {g.tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tag} · {t.name}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Can't find it?">
            <option value={UNLISTED}>Not in the list - send a photo</option>
          </optgroup>
        </select>
        {others === null && !othersError && <p className="mt-1 text-xs text-gray-500">Loading the other Lobos tools…</p>}
        {othersError && <p className="mt-1 text-xs text-amber-400">{othersError} Pick &quot;Not in the list&quot; if yours isn&apos;t there.</p>}
        {picked && <p className="mt-1 text-sm text-gray-300">Picked: {picked}</p>}
        {unlisted && <p className="mt-1 text-sm text-gray-300">Take a photo of the tool - the rating plate or the LOB sticker if you can. The office finds it from the photo.</p>}
      </div>
      <textarea className={`${input} min-h-[110px]`} placeholder="What's wrong? e.g. not hammering, cuts out, cracked housing" value={text} onChange={(e) => setText(e.target.value)} />
      <PhotoPicker
        big
        kind="FAULT"
        uploadUrl={`${api}/photos`}
        label={unlisted ? "Photo of the tool (needed)" : "Photo of the fault (optional)"}
        photoId={photo}
        onChange={setPhoto}
      />
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <button
        className={primary}
        disabled={!toolId || !text.trim() || (unlisted && !photo) || busy}
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
      {unlisted && !photo && <p className="-mt-2 text-center text-xs text-gray-500">Add the photo to send it.</p>}
    </div>
  );
}
