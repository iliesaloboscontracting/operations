import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { getThread, markSeen, postMessage } from "@/lib/messages/store";
import { appViewer } from "@/lib/messages/who";

// GET  /api/messages/:id -> the Office room or one of my one-to-ones, with "seen" on my messages
// POST /api/messages/:id { action: "SEEN" } -> I've opened it | { body, correctsId? } -> a reply / a correction
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const v = await appViewer();
  if ("denied" in v) return v.denied;
  const t = await getThread(v.me, (await params).id);
  if (!t) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(t);
});

export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const v = await appViewer();
  if ("denied" in v) return v.denied;
  const id = (await params).id;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const out = b.action === "SEEN" ? await markSeen(v.me, id) : await postMessage(v.me, id, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: b.action === "SEEN" ? 200 : 201 });
});
