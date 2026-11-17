import { NextRequest, NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { quoteFile } from "@/lib/tenders/board";
import { cleanFileName, fileId, tenderId } from "@/lib/tenders/rules";

// GET /api/directors/tenders/:id/quote-files/:fid -> a director's issued quote (it shows prices) from Estimating.
// Director access only. TND-001 (Ilies approved 17 Nov 2026): always a download (never opened inside the Operations
// site), sandboxed, no sniffing, PDF / Word only - Estimating's own disposition header is not passed on.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string; fid: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const { id, fid } = await paramsP;
  if (!tenderId(id) || !fileId(fid)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const res = await quoteFile(id, fid);
  if (!res) return NextResponse.json({ error: "Estimating isn't answering right now." }, { status: 502 });
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    return NextResponse.json({ error: "That file isn't there any more." }, { status: res.status === 403 ? 503 : 404 });
  }
  const type = res.headers.get("content-type") ?? "";
  const [safeType, ext] = type.startsWith("application/pdf") ? ["application/pdf", "pdf"]
    : type.startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ? ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"]
    : ["application/octet-stream", "bin"];
  // The name Estimating gave, if it sent one, tidied - only ever used as a download name.
  let given = "";
  try { given = decodeURIComponent(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? ""); } catch { given = ""; }
  const name = cleanFileName(given || `quote.${ext}`);
  return new NextResponse(res.body, {
    headers: {
      "content-type": safeType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
