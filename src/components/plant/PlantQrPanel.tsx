"use client";

import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { qrSvg } from "@/components/QrCode";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

// A Lobos-owned machine's pre-start QR sticker (stage 2, Ilies 10 Nov 2026) - on the Plant page, Managers and Admins.
// Like the truck QR (components/attendance/PosterPanel.tsx): the link is shown once, to print; Reprint switches the old
// one off at once; Off switches it off. The sticker says plainly it's the pre-start QR, NOT a sign-in.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function printSticker(title: string, subtitle: string | null, url: string) {
  const w = window.open("", "_blank");
  if (!w) return alert("Allow pop-ups for Operations to print the QR.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pre-start QR - ${esc(title)}</title>
<style>
  /* Playing-card size (Ilies, 12 Nov 2026: "about the same size as a card from a deck of cards") - 63 x 88 mm,
     dashed edge to cut along. */
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; text-align: center; color: #111; margin: 0; }
  .cut { border: 1px dashed #999; box-sizing: border-box; width: 63mm; height: 88mm; padding: 3mm 3mm 2mm;
         display: flex; flex-direction: column; align-items: center; overflow: hidden; }
  img.logo { height: 6mm; }
  h1 { font-size: 12pt; margin: 1.5mm 0 0.5mm; letter-spacing: 0.3px; }
  .site { font-size: 10pt; font-weight: bold; margin: 0; line-height: 1.15; max-height: 9mm; overflow: hidden; }
  .addr { font-size: 7pt; color: #444; margin: 0.5mm 0 0; }
  .qr { width: 44mm; height: 44mm; margin: 1.5mm auto 1mm; }
  .qr svg { width: 100%; height: 100%; }
  .not { font-size: 7.5pt; font-weight: bold; color: #b00; margin: 0 0 1mm; }
  .how { font-size: 6.5pt; line-height: 1.3; margin: 0; color: #222; }
</style></head><body>
  <div class="cut">
  <img class="logo" src="${location.origin}/logo.png" alt="Lobos">
  <h1>PRE-START CHECK</h1>
  <p class="site">${esc(title)}</p>
  ${subtitle ? `<p class="addr">${esc(subtitle)}</p>` : ""}
  <div class="qr">${qrSvg(url)}</div>
  <p class="not">NOT a sign-in - sign in on site as usual.</p>
  <p class="how">Scan with your phone camera at the <b>start</b> and <b>end</b> of each shift. Photos, hour meter, report any fault.</p>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  w.document.close();
}

type Qr = { resourceId: string | null; createdAt: string; createdBy: string | null };

export default function PlantQrPanel({ machine }: { machine: { id: string; name: string; type: string; ownership: string } }) {
  const { canEdit } = useAuth();
  const [qr, setQr] = useState<Qr | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = machine.type === "EQUIPMENT" && machine.ownership === "OWNED";
  const load = useCallback(() => {
    if (!canEdit || !owned) return;
    apiFetch("/api/plant/qr").then(async (r) => setQr(r.ok ? ((await r.json()) as Qr[]).find((x) => x.resourceId === machine.id) ?? null : null)).catch(() => setQr(null));
  }, [canEdit, owned, machine.id]);
  useEffect(load, [load]);
  if (!canEdit || !owned) return null;

  async function post(off: boolean) {
    if (off && !confirm(`Switch off the pre-start QR for ${machine.name}? It stops working straight away.`)) return;
    if (!off && qr && !confirm(`Print a new pre-start QR for ${machine.name}? The old sticker stops working straight away - replace it.`)) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/plant/qr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: machine.id, ...(off ? { off: true } : {}) }) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't make the QR."));
    if (!off) { const out = await res.json(); printSticker(out.title, out.subtitle, out.url); }
    load();
  }

  return (
    <div className="mt-3 rounded-xl border border-edge bg-panel p-3 text-xs">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-gray-200"><Printer size={14} /> Pre-start QR sticker</div>
      <p className="mb-2 text-gray-500">Operators scan it for the pre-start and post-check (hour meter, walk-around photos, faults). Not a sign-in. Shown once, to print - reprinting switches the old one off.</p>
      {error && <div className="mb-2 rounded-md bg-red-900/30 px-3 py-2 text-red-300">{error}</div>}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-gray-400">
          {qr === undefined ? "..." : qr ? `QR made ${new Date(qr.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}${qr.createdBy ? ` by ${qr.createdBy}` : ""}` : "No QR yet"}
        </span>
        <button className="rounded-lg border border-edge px-2.5 py-1 text-gray-300 hover:bg-panel2 disabled:opacity-50" disabled={busy} onClick={() => post(false)}>{qr ? "Reprint" : "Print QR"}</button>
        {qr && <button className="text-gray-500 hover:text-red-400" disabled={busy} onClick={() => post(true)}>Off</button>}
      </div>
    </div>
  );
}
