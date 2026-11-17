import { NextRequest, NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { quoteFile } from "@/lib/tenders/board";
import { safeId } from "@/lib/tenders/rules";

// GET /api/directors/tenders/:id/quote-files/:fid -> a director's issued quote (it shows prices) from Estimating.
// Director access only; served as a download-safe file (no sniffing, PDF / Word only).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string; fid: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const { id, fid } = await paramsP;
  if (!safeId(id) || !safeId(fid)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const res = await quoteFile(id, fid);
  if (!res) return NextResponse.json({ error: "Estimating isn't answering right now." }, { status: 502 });
  if (!res.ok || !res.body) return NextResponse.json({ error: "That file isn't there any more." }, { status: res.status === 403 ? 503 : 404 });
  const type = res.headers.get("content-type") ?? "";
  const safeType = type.startsWith("application/pdf") ? "application/pdf"
    : type.startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/octet-stream";
  const disp = res.headers.get("content-disposition");
  return new NextResponse(res.body, {
    headers: {
      "content-type": safeType,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-disposition": disp && /^(inline|attachment)/.test(disp) ? disp : "attachment",
    },
  });
});
