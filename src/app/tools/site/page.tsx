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
import type { ResourceDTO, ToolboxDTO, ToolDTO } from "@/lib/types";

const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

type Submission = {
  id: string;
  kind: "REGISTER" | "CHECK" | "FAULT";
  status: "PENDING" | "APPLIED" | "REJECTED";
  from: string;
  photoIds: string[];
  photos: { id: string; kind: string }[];
  description: string | null;
  reading: (RegisterPrefill["reading"] & { typedOnSite?: string[] }) | null;
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
  kind?: string;
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
  const [linkKind, setLinkKind] = useState<"SUPERVISOR" | "OFFICE">("SUPERVISOR");
  const [people, setPeople] = useState<ResourceDTO[]>([]);
  const [toCheck, setToCheck] = useState<ToolDTO[]>([]);
  const [madeLink, setMadeLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [s, l, b, t, p] = await Promise.all([
      apiFetch("/api/site-submissions"),
      apiFetch("/api/site-links"),
      apiFetch("/api/toolboxes"),
      apiFetch("/api/tools"),
      apiFetch("/api/resources?type=PERSONNEL"),
    ]);
    if (s.ok) setSubs(await s.json());
    if (t.ok) setToCheck(((await t.json()) as ToolDTO[]).filter((x) => x.needsCheck));
    if (p.ok) setPeople(((await p.json()) as ResourceDTO[]).filter((x) => x.type === "PERSONNEL"));
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
  // Office / yard links can go to anyone in the Personnel register.
  const linkPeople: { id: string; name: string }[] = linkKind === "OFFICE" ? people : supervisors;

  return (
    <PageShell title="From site" subtitle="Tools added from site, faults reported, and everyone's private phone links.">
      <ToolsTabs />
      {error && <div className="mb-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <section>
              <h2 className="mb-1 text-sm font-semibold text-gray-200">Added from site - to check ({toCheck.length})</h2>
              <p className="mb-2 text-xs text-gray-500">Already in the inventory. Check the details against the photos, fix anything, and mark them checked.</p>
              {toCheck.length === 0 && <p className="text-xs text-gray-500">Nothing to check.</p>}
              <div className="space-y-3">
                {toCheck.map((t) => (
                  <ToCheckCard key={t.id} tool={t} canEdit={canEdit} onSave={(body) => act(() => json(`/api/tools/${t.id}`, "PATCH", body), "Couldn't save the tool.")} />
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-200">Waiting for the office ({pending.length})</h2>
              {pending.length === 0 && <p className="text-xs text-gray-500">Nothing waiting. Faults reported from site show up here.</p>}
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
                              <div className="text-xs text-gray-400">Serial {s.reading.serialNumber || "not given"} · {s.reading.toolType}</div>
                              {(s.reading.typedOnSite?.length ?? 0) > 0 && (
                                <div className="text-xs text-brand-300">
                                  Typed in on site: {s.reading.typedOnSite!.map((f) => ({ toolType: "what it is", brand: "brand", model: "model", serialNumber: "serial" } as Record<string, string>)[f] ?? f).join(", ")}
                                  {s.photos.every((p) => p.kind !== "PLATE") && " (no plate photo - check the serial on the tool)"}
                                </div>
                              )}
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
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-200"><Link2 size={14} /> Phone links</h2>
            <p className="mb-3 text-xs text-gray-500">
              <b className="text-gray-300">Supervisor link</b>: add tools to their toolbox, check it, report faults. <b className="text-gray-300">Office / yard link</b>: add tools to
              the inventory (any toolbox or the yard). Each person gets their own private link; making a new one switches their old one of that kind off.
            </p>
            {canEdit && (
              <div className="mb-3 flex flex-wrap gap-2">
                <select
                  className="rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200"
                  value={linkKind}
                  onChange={(e) => {
                    setLinkKind(e.target.value as "SUPERVISOR" | "OFFICE");
                    setNewLinkFor("");
                  }}
                >
                  <option value="SUPERVISOR">Supervisor link</option>
                  <option value="OFFICE">Office / yard link</option>
                </select>
                <select className="min-w-0 flex-1 rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200" value={newLinkFor} onChange={(e) => setNewLinkFor(e.target.value)}>
                  <option value="">{linkKind === "OFFICE" ? "Person…" : "Supervisor…"}</option>
                  {linkPeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button
                  className={btn}
                  disabled={!newLinkFor}
                  onClick={async () => {
                    const out = await act(() => json("/api/site-links", "POST", { resourceId: newLinkFor, kind: linkKind }), "Couldn't make the link.");
                    if (out) {
                      const who = linkPeople.find((p) => p.id === newLinkFor)?.name ?? "";
                      setMadeLink({ name: linkKind === "OFFICE" ? `${who} (office / yard)` : who, url: out.url });
                      setCopied(false);
                      setNewLinkFor("");
                    }
                  }}
                >
                  Make link
                </button>
              </div>
            )}
            {linkKind === "SUPERVISOR" && supervisors.length === 0 && <p className="mb-3 text-xs text-amber-500">Set a supervisor on a toolbox first.</p>}
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
                    <div className="text-gray-200">
                      {l.resource.name}
                      <span className="ml-1.5 rounded-full bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">{l.kind === "OFFICE" ? "Office / yard" : "Supervisor"}</span>
                    </div>
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
            platePhotoId: registering.photos.find((p) => p.kind === "PLATE")?.id ?? null,
            conditionPhotoId: registering.photos.find((p) => p.kind === "CONDITION")?.id ?? null,
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

// A tool a supervisor added from site: already in the inventory, waiting for
// the office to check its details against the photos.
function ToCheckCard({
  tool: t,
  canEdit,
  onSave,
}: {
  tool: ToolDTO;
  canEdit: boolean;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({
    name: t.name,
    brand: t.brand ?? "",
    model: t.model ?? "",
    serialNumber: t.serialNumber ?? "",
    plateUnreadable: !!t.plateUnreadable,
  });
  const inp = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200";
  const photos = t.photos ?? [];
  return (
    <div className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span className="font-mono text-gray-300">{t.tag}</span>
        <span className="font-semibold text-gray-100">{t.name}</span>
        <span>
          · {t.toolbox?.name ?? "Yard"}
          {t.addedBy ? ` · added by ${t.addedBy}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {photos.map((p) => (
          <a key={p.id} href={`/api/tools/photos/${p.id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/tools/photos/${p.id}`} alt={p.kind} className="h-24 w-24 rounded-md border border-edge object-cover" />
          </a>
        ))}
        {!editing ? (
          <div className="min-w-0 flex-1 text-sm text-gray-200">
            <div>{[t.brand, t.model].filter(Boolean).join(" ") || "No brand / model"}</div>
            <div className="text-xs text-gray-400">
              {t.serialNumber ? (
                <>
                  Serial <span className="font-mono">{t.serialNumber}</span>
                </>
              ) : t.plateUnreadable ? (
                "Plate not readable"
              ) : (
                "No serial"
              )}
              {t.serialNumber && photos.every((p) => p.kind !== "PLATE") && <span className="text-amber-500"> - typed in, no plate photo</span>}
            </div>
            {t.conditionNotes && <div className="text-xs text-amber-500">Damage: {t.conditionNotes}</div>}
          </div>
        ) : (
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
            <input className={inp} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="What it is" />
            <input className={inp} value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })} placeholder="Brand" />
            <input className={inp} value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} placeholder="Model" />
            <input
              className={inp}
              disabled={v.plateUnreadable}
              value={v.plateUnreadable ? "" : v.serialNumber}
              onChange={(e) => setV({ ...v, serialNumber: e.target.value })}
              placeholder={v.plateUnreadable ? "Plate not readable" : "Serial number"}
            />
            <label className="col-span-2 flex items-center gap-1.5 text-xs text-gray-400">
              <input type="checkbox" checked={v.plateUnreadable} onChange={(e) => setV({ ...v, plateUnreadable: e.target.checked })} /> Plate not readable
            </label>
          </div>
        )}
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button className={btn} onClick={() => onSave({ needsCheck: false })}>
                Looks right - mark checked
              </button>
              <button className={quiet} onClick={() => setEditing(true)}>
                Fix details
              </button>
            </>
          ) : (
            <>
              <button
                className={btn}
                disabled={!v.name.trim() || (!v.plateUnreadable && !v.serialNumber.trim())}
                onClick={async () => {
                  const out = await onSave({ ...v, serialNumber: v.plateUnreadable ? "" : v.serialNumber, needsCheck: false });
                  if (out) setEditing(false);
                }}
              >
                Save and mark checked
              </button>
              <button className={quiet} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
