// The checks & service history replies (12 Nov 2026), shared by the QR's public routes (api/site/plant/[code]/history)
// and the Plant page's (api/plant/[id]/history). Every reply - JSON, CSV or the PDF's data - passes linkSafe first: a
// "$" figure anywhere and nothing goes out.
import { NextResponse } from "next/server";
import { linkSafe } from "../receipts/rules";
import { checksCsv, fileName, parseDays, parseWhat, serviceCsv, type MachineHistory } from "./history";
import { renderHistoryPdf } from "./historyPdf";

const REFUSED = { error: "Something went wrong - call the office." };
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export const historyParams = (q: URLSearchParams) => ({
  days: parseDays(q.get("days")),
  what: parseWhat(q.get("what")),
  format: q.get("format") === "csv" ? ("csv" as const) : ("pdf" as const),
});

export function historyJson(h: MachineHistory) {
  return linkSafe(h) ? NextResponse.json(h, { headers }) : NextResponse.json(REFUSED, { status: 500 });
}

export async function historyFile(h: MachineHistory, what: "checks" | "service", format: "pdf" | "csv") {
  if (!linkSafe(h)) return NextResponse.json(REFUSED, { status: 500 });
  const name = fileName(h, what, format);
  if (format === "csv") {
    const text = what === "service" ? serviceCsv(h) : checksCsv(h);
    if (!linkSafe(text)) return NextResponse.json(REFUSED, { status: 500 });
    return new NextResponse("﻿" + text, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
    });
  }
  const pdf = await renderHistoryPdf(h, what);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Content-Length": String(pdf.length) },
  });
}
