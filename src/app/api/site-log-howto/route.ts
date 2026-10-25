import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { assertNoMoney } from "@/lib/moneyGuard";
import { renderHowtoPdf } from "@/lib/howtoPdf";

// GET /api/site-log-howto[?download=1] - the supervisors' daily log how-to as
// a one-page A4 PDF (Task L), for Ilies to print or send to Damien and Tom.
// Drawn from docs/lci/SUPERVISOR-DAILY-LOG-HOWTO.md, so editing the doc updates
// it. Manager+. No link secrets on it, and never a dollar figure.
const HOWTO_FILE = path.join(process.cwd(), "docs", "lci", "SUPERVISOR-DAILY-LOG-HOWTO.md");

export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const md = await fs.readFile(HOWTO_FILE, "utf8").catch(() => null);
  if (md == null) return NextResponse.json({ error: "The how-to document isn't on the server." }, { status: 404 });
  if (!assertNoMoney(md)) return NextResponse.json({ error: "The how-to looks like it contains a dollar figure - remove it first." }, { status: 422 });
  const buffer = await renderHowtoPdf(md);
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="Daily site log - how to.pdf"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
});
