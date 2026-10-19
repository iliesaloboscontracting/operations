"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { qrSvg } from "@/components/QrCode";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

type Project = { id: string; name: string; status: string };
type Vehicle = { id: string; name: string; identifier: string | null; category: string | null; ownership: string };
type Poster = { projectId: string | null; place: string | null; resourceId: string | null; createdAt: string; createdBy: string | null };
// What a poster is for - the body sent to /api/attendance/poster.
type Target = { projectId: string } | { place: "OFFICE" | "YARD" } | { vehicleId: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Opens the poster in a new window ready to print: logo, where it is, the
// QR, and plain instructions. Truck QRs print smaller, for the cab.
function printPoster(title: string, subtitle: string | null, url: string, place: string | null) {
  const w = window.open("", "_blank");
  if (!w) return alert("Allow pop-ups for Operations to print the QR.");
  const truck = place === "VEHICLE";
  const note =
    place === null
      ? "Your site supervisor confirms poster sign-ins. Hire / subcontractor workers: choose \"I'm from a hire company\"."
      : truck
        ? "Drivers: sign in when you start in this truck, sign out when you finish. Swapping trucks? Just scan the next one."
        : "Not on the list? Tap \"I'm not on this list\" and search your name. Hire workers: choose \"I'm from a hire company\".";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Sign-in QR - ${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; text-align: center; color: #111; margin: 0; }
  img.logo { height: ${truck ? 40 : 60}px; margin-top: ${truck ? 4 : 10}mm; }
  h1 { font-size: ${truck ? 28 : 40}px; margin: ${truck ? 5 : 10}mm 0 2mm; }
  .site { font-size: ${truck ? 22 : 30}px; font-weight: bold; margin: 0; }
  .addr { font-size: 16px; color: #444; margin: 2mm 0 6mm; }
  .qr { width: ${truck ? 80 : 120}mm; height: ${truck ? 80 : 120}mm; margin: 0 auto; }
  .qr svg { width: 100%; height: 100%; }
  ol { text-align: left; display: inline-block; font-size: ${truck ? 16 : 20}px; line-height: 1.6; margin-top: 6mm; }
  .note { font-size: 13px; color: #555; margin-top: 4mm; }
  .cut { border: 1px dashed #999; display: inline-block; padding: 4mm 8mm; }
</style></head><body>
  <div class="${truck ? "cut" : ""}">
  <img class="logo" src="${location.origin}/logo.png" alt="Lobos">
  <h1>SIGN IN / SIGN OUT</h1>
  <p class="site">${esc(title)}</p>
  <p class="addr">${subtitle ? esc(subtitle) : ""}</p>
  <div class="qr">${qrSvg(url)}</div>
  <ol>
    <li>Open your phone camera and point it at the code.</li>
    <li>Tap the link, pick your name (first time only).</li>
    <li>Tap <b>Sign in</b> when you start, <b>Sign out</b> when you finish.</li>
  </ol>
  <p class="note">${esc(note)}</p>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  w.document.close();
}

export default function PosterPanel({
  projects,
  vehicles,
  posters,
  canEdit,
  onChanged,
}: {
  projects: Project[];
  vehicles: Vehicle[];
  posters: Poster[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const activeProjects = projects.filter((p) => p.status === "ACTIVE" || posters.some((x) => x.projectId === p.id));
  // Lobos-owned trucks only (Ilies, 20 Oct 2026) - not trailers.
  const trucks = vehicles.filter((v) => v.ownership === "OWNED" && v.category !== "Other");

  async function post(key: string, name: string, target: Target, has: boolean, off = false) {
    if (off && !confirm(`Switch off the QR for ${name}? It stops working straight away.`)) return;
    if (!off && has && !confirm(`Print a new QR for ${name}? The old one stops working straight away - replace it.`)) return;
    setBusy(key);
    setError(null);
    const res = await apiFetch("/api/attendance/poster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target, ...(off ? { off: true } : {}) }) });
    setBusy(null);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't make the QR."));
    if (!off) {
      const out = await res.json();
      printPoster(out.title, out.subtitle, out.url, out.place);
    }
    onChanged();
  }

  const row = (key: string, name: string, sub: string | null, target: Target, poster: Poster | undefined) => (
    <li key={key} className="flex items-center gap-2 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate text-gray-200">{name}</div>
        <div className="text-gray-500">
          {sub && `${sub} · `}
          {poster ? `QR made ${new Date(poster.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}${poster.createdBy ? ` by ${poster.createdBy}` : ""}` : "No QR yet"}
        </div>
      </div>
      {canEdit && (
        <>
          <button className="rounded-lg border border-edge px-2.5 py-1 text-gray-300 hover:bg-panel2 disabled:opacity-50" disabled={busy === key} onClick={() => post(key, name, target, !!poster)}>
            {poster ? "Reprint" : "Print QR"}
          </button>
          {poster && <button className="text-gray-500 hover:text-red-400" onClick={() => post(key, name, target, true, true)}>Off</button>}
        </>
      )}
    </li>
  );

  return (
    <section className="min-w-0 space-y-4">
      <div>
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-200"><Printer size={14} /> Office, yard &amp; truck QRs</h2>
        <p className="mb-2 text-xs text-gray-500">Fixed QRs to sign in and out - they count straight away; anything odd is flagged here. A truck QR goes in the cab.</p>
        <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
          {row("OFFICE", "Office", "Office staff", { place: "OFFICE" }, posters.find((x) => x.place === "OFFICE"))}
          {row("YARD", "Yard", "Anyone working in the yard", { place: "YARD" }, posters.find((x) => x.place === "YARD"))}
          {trucks.map((v) => row(`V${v.id}`, v.name, v.category, { vehicleId: v.id }, posters.find((x) => x.place === "VEHICLE" && x.resourceId === v.id)))}
        </ul>
      </div>
      <div>
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-200"><Printer size={14} /> Site posters</h2>
        <p className="mb-2 text-xs text-gray-500">
          A QR for the site sign / gate, for when the supervisor isn&apos;t there. Poster sign-ins wait for the supervisor to confirm. Each QR is shown once, to print -
          reprinting switches the old one off.
        </p>
        {error && <div className="mb-2 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
        <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
          {activeProjects.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">No active projects.</li>}
          {activeProjects.map((p) => row(`P${p.id}`, p.name, null, { projectId: p.id }, posters.find((x) => x.projectId === p.id)))}
        </ul>
      </div>
    </section>
  );
}
