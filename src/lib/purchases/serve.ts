// Sending a supplier's quote file (2 Nov 2026) once the route has decided the caller may see that request: shown in
// the browser, never cached, its type fixed (nosniff) and its name cleaned. Shared by the app's and the OFFICE link's
// file routes. And reading a purchase POST's body.
import { NextResponse } from "next/server";
import { readQuoteFile } from "./files";
import { BODY_TOO_LARGE } from "./quotes";
import { readJsonBody } from "../jsonBody";

// The body of a purchase POST (in-app and the OFFICE link). One the server can't read - in practice one over Next's
// 10 MB request limit, which arrives cut short - is 413 with plain words, never "Say what you need" (option A, 2 Nov 2026).
export const purchaseBody = (req: Request) => readJsonBody(req, BODY_TOO_LARGE);

export async function quoteFileReply(q: { fileName: string | null; fileMime: string | null; fileOriginalName: string | null }) {
  if (!q.fileName) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readQuoteFile(q.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The file is missing." }, { status: 404 });
  const name = (q.fileOriginalName ?? "quote").replace(/[^\w .-]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": q.fileMime ?? "application/octet-stream", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
