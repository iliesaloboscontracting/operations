import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { UPLOAD_FILE_MAX, UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";
import { logQuote } from "@/lib/tenders/board";
import { bytesMatch, cleanFileName, estimatingWords, quoteFileKind, quoteMeta, tenderId as isTenderId } from "@/lib/tenders/rules";

// POST /api/directors/tenders/log-quote { tenderId?, fileName, dataUrl, quoteNo?, builder, valueExGst, revision?,
// submittedDate?, version? } -> "Log my quote" (17 Nov 2026): a director's issued quote goes on the tender in
// Estimating (on a tender, or matched / registered by its quote number). PDF or Word, 7 MB. Form version: the person
// types the quote's details - Claude doesn't read the file.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const read = await readJsonBody(req, UPLOAD_TOO_LARGE);
  if ("denied" in read) return read.denied;
  const b = read.b;
  const tenderId = b.tenderId == null || b.tenderId === "" ? null : b.tenderId;
  if (tenderId !== null && !isTenderId(tenderId)) return NextResponse.json({ error: "Unknown tender." }, { status: 404 });
  const m = quoteMeta(b, tenderId === null);
  if ("error" in m) return NextResponse.json({ error: m.error }, { status: 400 });
  const fileName = cleanFileName(typeof b.fileName === "string" ? b.fileName : "");
  const dataUrl = typeof b.dataUrl === "string" ? b.dataUrl : "";
  const kind = quoteFileKind(fileName, dataUrl);
  if (!kind) return NextResponse.json({ error: "Attach the quote as a PDF or Word (.docx) file." }, { status: 400 });
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (bytes.length > UPLOAD_FILE_MAX) return NextResponse.json({ error: UPLOAD_TOO_LARGE }, { status: 413 });
  if (!bytesMatch(kind, bytes)) return NextResponse.json({ error: "That file isn't a real PDF / Word file." }, { status: 400 });
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
  const r = await logQuote(tenderId, buf, fileName, m.meta, user.name);
  if (r.status !== 200 && r.status !== 201) return NextResponse.json({ error: estimatingWords(r.status, r.body?.code, r.body?.error) }, { status: r.status === 0 ? 502 : r.status });
  return NextResponse.json({ ok: true, created: !!(r.body as { created?: boolean } | null)?.created });
});
