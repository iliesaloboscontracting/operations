"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, ClipboardCopy, Link2, ScanLine, Wrench } from "lucide-react";
import PageShell from "@/components/PageShell";
import ToolsTabs from "@/components/tools/ToolsTabs";
import RegisterByPhoto, { type RegisterPrefill } from "@/components/tools/RegisterByPhoto";
import CheckResultView from "@/components/tools/CheckResultView";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { CheckResult } from "@/lib/toolboxCheck";
import type { ToolboxDTO } from "@/lib/types";

const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

type Submission = {
  id: string;
  kind: "REGISTER" | "CHECK" | "FAULT";
  status: "PENDING" | "APPLIED" | "REJECTED";
  from: string;
  photoIds: string[];
  description: string | null;
  reading: RegisterPrefill["reading"];
  tool: { id: string; tag: string; name: string; serialNumber: string | null } | null;
  toolbox: { id: string; name: string } | null;
  checkResult: CheckResult | null;
  reviewedBy: string | null;
  createdAt: string;
};
type SiteLinkRow = {
  id: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  resource: { id: string; name: string };
  _count: { submissions: number };
};

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const json = (url: string, method: string, body: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function FromSitePage() {
  const { canEdit } = useAuth();
  const [subs, setSubs] = useState<Submission[]>([]);
  const [links, setLinks] = useState<SiteLinkRow[]>([]);
  const [boxes, setBoxes] = useState<ToolboxDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState<Submission | null>(null);
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  const [newLinkFor, setNewLinkFor] = useState("");
  const [madeLink, setMadeLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [s, l, b] = await Promise.all([apiFetch("/api/site-submissions"), apiFetch("/api/site-links"), apiFetch("/api/toolboxes")]);
    if (s.ok) setSubs(await s.json());
    if (l.ok) setLinks(await l.json());
    if (b.ok) setBoxes(await b.json());
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<Response>, fallback: string) {
    setError(null);
    const res = await fn();
    if (!res.ok) {
      setError(await serverErrorMessage(res, fallback));
      return null;
    }
    const out = await res.json();
    await load();
    return out;
  }

  const pending = subs.filter((s) => s.status === "PENDING");
  const handled = subs.filter((s) => s.status !== "PENDING");
  // Supervisors = people in charge of a toolbox (links are for them only).
  const supervisors = Array.from(new Map(boxes.filter((b) => b.supervisor).map((b) => [b.supervisor!.id, b.supervisor!])).values());

  return (
    <PageShell title="From site" subtitle="Photos supervisors send from site, and their private links.">
      <ToolsTabs />
      {error && <div className="mb-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-200">Waiting for the office ({pending.length})</h2>
              {pending.length === 0 && <p className="text-xs text-gray-500">Nothing waiting. New tools and faults sent from site show up here.</p>}
              <div className="space-y-3">
                {pending.map((s) => (
                  <div key={s.id} className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      {s.kind === "REGISTER" ? <Camera size={14} className="text-brand-300" /> : <Wrench size={14} className="text-amber-500" />}
                      <span className="font-semibold text-gray-100">{s.kind === "REGISTER" ? "New tool" : `Fault on ${s.tool?.tag ?? "a tool"}`}</span>
                      <span>from {s.from} · {when(s.createdAt)}</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {s.photoIds.map((id) => (
                        <a key={id} href={`/api/tools/photos/${id}`} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/tools/photos/${id}`} alt="From site" className="h-24 w-24 rounded-md border border-edge object-cover" />
                        </a>
                      ))}
                      <div className="min-w-0 flex-1 text-sm text-gray-200">
                        {s.kind === "REGISTER" ? (
                          s.reading ? (
                            <>
                              <div>{[s.reading.brand, s.reading.model].filter(Boolean).join(" ") || s.reading.toolType || "Unread tool"}</div>
                              <div className="text-xs text-gray-400">Serial {s.reading.serialNumber || "not readable"} · {s.reading.toolType}</div>
                              {s.reading.damage && <div className="text-xs text-amber-500">Damage: {s.reading.damage}</div>}
                            </>
                          ) : (
                            <div className="text-xs text-gray-400">The plate couldn&apos;t be read - fill it in from the photo.</div>
                          )
                        ) : (
                          <>
                            <div className="text-xs text-gray-400">{s.tool?.name}{s.tool?.serialNumber ? ` · ${s.tool.serialNumber}` : ""}</div>
                            <div>{s.description}</div>
                          </>
                        )}
                        {s.kind === "REGISTER" && s.description && <div className="mt-1 text-xs text-gray-400">Note: {s.description}</div>}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {s.kind === "REGISTER" ? (
                          <button className={btn} onClick={() => setRegistering(s)}>Check and register</button>
                        ) : (
                          <button className={btn} onClick={() => act(() => json(`/api/site-submissions/${s.id}`, "PATCH", { status: "APPLIED", notWorking: true }), "Couldn't log the fault.")}>
                            Log fault (marks Needs repair)
                          </button>
                        )}
                        <button className={quiet} onClick={() => act(() => json(`/api/site-submissions/${s.id}`, "PATCH", { status: "REJECTED" }), "Couldn't reject it.")}>
                          Not needed
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-200">Last 14 days</h2>
              {handled.length === 0 && <p className="text-xs text-gray-500">Nothing yet.</p>}
              <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
                {handled.map((s) => (
                  <li key={s.id} className="px-4 py-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.kind === "CHECK" ? <ScanLine size={13} className="text-brand-300" /> : s.kind === "REGISTER" ? <Camera size={13} className="text-gray-400" /> : <Wrench size={13} className="text-gray-400" />}
                      <span className="text-gray-200">
                        {s.kind === "CHECK" ? `Toolbox check - ${s.toolbox?.name ?? ""}` : s.kind === "REGISTER" ? "New tool" : `Fault on ${s.tool?.tag ?? "a tool"}`}
                      </span>
                      <span className="text-gray-500">{s.from} · {when(s.createdAt)}</span>
                      {s.kind === "CHECK" && s.checkResult ? (
                        <>
                          <span className={s.checkResult.missing.length || s.checkResult.foreign.length ? "text-amber-500" : "text-emerald-400"}>
                            {s.checkResult.missing.length || s.checkResult.foreign.length
                              ? `${s.checkResult.missing.length} not seen, ${s.checkResult.foreign.length} from other boxes`
                              : "all good"}
                          </span>
                          <button className="text-brand-300 hover:underline" onClick={() => setOpenCheck(openCheck === s.id ? null : s.id)}>
                            {openCheck === s.id ? "Hide" : "Show"}
                          </button>
                        </>
                      ) : (
                        <span className="text-gray-500">{s.status === "APPLIED" ? "Done" : "Not needed"}{s.reviewedBy ? ` · ${s.reviewedBy}` : ""}</span>
                      )}
                    </div>
                    {openCheck === s.id && s.checkResult && (
                      <div className="mt-3">
                        <CheckResultView result={s.checkResult} boxName={s.toolbox?.name ?? ""} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="min-w-0">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-200"><Link2 size={14} /> Supervisors&apos; links</h2>
            <p className="mb-3 text-xs text-gray-500">
              Each supervisor gets their own private link to the Site photos page. It can only send photos. Making a new link switches the old one off.
            </p>
            {canEdit && (
              <div className="mb-3 flex gap-2">
                <select className="min-w-0 flex-1 rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200" value={newLinkFor} onChange={(e) => setNewLinkFor(e.target.value)}>
                  <option value="">Supervisor…</option>
                  {supervisors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button
                  className={btn}
                  disabled={!newLinkFor}
                  onClick={async () => {
                    const out = await act(() => json("/api/site-links", "POST", { resourceId: newLinkFor }), "Couldn't make the link.");
                    if (out) {
                      setMadeLink({ name: supervisors.find((p) => p.id === newLinkFor)?.name ?? "", url: out.url });
                      setCopied(false);
                      setNewLinkFor("");
                    }
                  }}
                >
                  Make link
                </button>
              </div>
            )}
            {supervisors.length === 0 && <p className="mb-3 text-xs text-amber-500">Set a supervisor on a toolbox first - links are for supervisors only.</p>}
            {madeLink && (
              <div className="mb-3 rounded-lg border border-brand-500 bg-brand-600/10 p-3 text-xs">
                <div className="mb-1 font-semibold text-gray-100">Link for {madeLink.name}</div>
                <div className="mb-2 break-all font-mono text-gray-300">{madeLink.url}</div>
                <button
                  className={`${btn} flex items-center gap-1`}
                  onClick={async () => {
                    await navigator.clipboard.writeText(madeLink.url);
                    setCopied(true);
                  }}
                >
                  <ClipboardCopy size={12} /> {copied ? "Copied" : "Copy link"}
                </button>
                <p className="mt-2 text-gray-400">Send it to {madeLink.name} directly (text or WhatsApp to them only). This is the only time it&apos;s shown.</p>
              </div>
            )}
            <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
              {links.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">No links yet.</li>}
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="text-gray-200">{l.resource.name}</div>
                    <div className="text-gray-500">
                      Made {when(l.createdAt)}{l.lastUsedAt ? ` · last used ${when(l.lastUsedAt)}` : " · not used yet"} · {l._count.submissions} sent
                    </div>
                  </div>
                  {l.revokedAt ? (
                    <span className="text-gray-500">Off</span>
                  ) : (
                    canEdit && (
                      <button className={quiet} onClick={() => confirm(`Switch off ${l.resource.name}'s link? It stops working straight away.`) && act(() => json(`/api/site-links/${l.id}`, "PATCH", { revoke: true }), "Couldn't switch it off.")}>
                        Switch off
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {registering && (
        <RegisterByPhoto
          prefill={{
            platePhotoId: registering.photoIds[0] ?? null,
            conditionPhotoId: registering.photoIds[1] ?? null,
            reading: registering.reading,
            toolboxId: registering.toolbox?.id ?? null,
            note: registering.description,
          }}
          onCreated={async (toolId) => {
            const res = await json(`/api/site-submissions/${registering.id}`, "PATCH", { status: "APPLIED", appliedRef: toolId });
            if (!res.ok) throw new Error(await serverErrorMessage(res, "The tool was saved but the site item couldn't be closed."));
          }}
          onSaved={load}
          onClose={() => setRegistering(null)}
        />
      )}
    </PageShell>
  );
}
