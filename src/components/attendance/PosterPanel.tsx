"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { qrSvg } from "@/components/QrCode";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

type Project = { id: string; name: string; status: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Opens the poster in a new window ready to print: logo, site name, the QR,
// and plain instructions.
function printPoster(project: string, address: string | null, url: string) {
  const w = window.open("", "_blank");
  if (!w) return alert("Allow pop-ups for Operations to print the poster.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Sign-in poster - ${esc(project)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; text-align: center; color: #111; margin: 0; }
  img.logo { height: 60px; margin-top: 10mm; }
  h1 { font-size: 40px; margin: 10mm 0 2mm; }
  .site { font-size: 30px; font-weight: bold; margin: 0; }
  .addr { font-size: 16px; color: #444; margin: 2mm 0 8mm; }
  .qr { width: 120mm; height: 120mm; margin: 0 auto; }
  .qr svg { width: 100%; height: 100%; }
  ol { text-align: left; display: inline-block; font-size: 20px; line-height: 1.6; margin-top: 8mm; }
  .note { font-size: 13px; color: #555; margin-top: 6mm; }
</style></head><body>
  <img class="logo" src="${location.origin}/logo.png" alt="Lobos">
  <h1>SIGN IN / SIGN OUT</h1>
  <p class="site">${esc(project)}</p>
  <p class="addr">${address ? esc(address) : ""}</p>
  <div class="qr">${qrSvg(url)}</div>
  <ol>
    <li>Open your phone camera and point it at the code.</li>
    <li>Tap the link, pick your name (first time only).</li>
    <li>Tap <b>Sign in</b> when you arrive, <b>Sign out</b> when you leave.</li>
  </ol>
  <p class="note">Your site supervisor confirms poster sign-ins. Hire / subcontractor workers: choose "I'm from a hire company".</p>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  w.document.close();
}

export default function PosterPanel({
  projects,
  posters,
  canEdit,
  onChanged,
}: {
  projects: Project[];
  posters: { projectId: string | null; createdAt: string; createdBy: string | null }[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const active = projects.filter((p) => p.status === "ACTIVE" || posters.some((x) => x.projectId === p.id));

  async function make(p: Project) {
    const has = posters.some((x) => x.projectId === p.id);
    if (has && !confirm(`Print a new poster for ${p.name}? The old poster stops working straight away - replace it on site.`)) return;
    setBusy(p.id);
    setError(null);
    const res = await apiFetch("/api/attendance/poster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: p.id }) });
    setBusy(null);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't make the poster."));
    const out = await res.json();
    printPoster(out.project, out.address, out.url);
    onChanged();
  }
  async function off(p: Project) {
    if (!confirm(`Switch off the poster at ${p.name}? It stops working straight away.`)) return;
    await apiFetch("/api/attendance/poster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: p.id, off: true }) });
    onChanged();
  }

  return (
    <section className="min-w-0">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-200"><Printer size={14} /> Site posters</h2>
      <p className="mb-3 text-xs text-gray-500">
        A QR for the site sign / gate, for when the supervisor isn&apos;t there. Poster sign-ins wait for the supervisor to confirm. The code is shown once, to print -
        reprinting switches the old one off.
      </p>
      {error && <div className="mb-2 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
        {active.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">No active projects.</li>}
        {active.map((p) => {
          const poster = posters.find((x) => x.projectId === p.id);
          return (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate text-gray-200">{p.name}</div>
                <div className="text-gray-500">
                  {poster ? `Poster made ${new Date(poster.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}${poster.createdBy ? ` by ${poster.createdBy}` : ""}` : "No poster"}
                </div>
              </div>
              {canEdit && (
                <>
                  <button className="rounded-lg border border-edge px-2.5 py-1 text-gray-300 hover:bg-panel2 disabled:opacity-50" disabled={busy === p.id} onClick={() => make(p)}>
                    {poster ? "Reprint" : "Print poster"}
                  </button>
                  {poster && <button className="text-gray-500 hover:text-red-400" onClick={() => off(p)}>Off</button>}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
