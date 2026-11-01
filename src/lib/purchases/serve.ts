// Sending a supplier's quote file (2 Nov 2026) once the route has decided the caller may see that request: shown in
// the browser, never cached, its type fixed (nosniff) and its name cleaned. Shared by the app's and the OFFICE link's
// file routes.
import { NextResponse } from "next/server";
import { readQuoteFile } from "./files";

export async function quoteFileReply(q: { fileName: string | null; fileMime: string | null; fileOriginalName: string | null }) {
  if (!q.fileName) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readQuoteFile(q.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The file is missing." }, { status: 404 });
  const name = (q.fileOriginalName ?? "quote").replace(/[^\w .-]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": q.fileMime ?? "application/octet-stream", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
