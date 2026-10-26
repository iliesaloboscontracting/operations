import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { fileForDownload, removeFile } from "@/lib/compliance/store";
import { readComplianceFile } from "@/lib/compliance/files";

// GET  /api/compliance/files/:id -> the file, shown in the browser (not cached). Accounts + Admins only.
// POST /api/compliance/files/:id { action: "REMOVE" } -> hidden from the record; the file itself is kept.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const f = await fileForDownload((await params).id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readComplianceFile(f.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The file is missing." }, { status: 404 });
  const name = f.originalName.replace(/[^\w .-]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": f.mime,
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  if (String(b.action ?? "").toUpperCase() !== "REMOVE") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const out = await removeFile(g.user.name, (await params).id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
