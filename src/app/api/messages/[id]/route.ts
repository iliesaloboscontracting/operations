import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { deleteMessage, editMessage, getThread, markSeen, postMessage } from "@/lib/messages/store";
import { appViewer } from "@/lib/messages/who";

// GET  /api/messages/:id -> the Office room or one of my one-to-ones, with "seen" on my messages
// POST /api/messages/:id { action: "SEEN" } -> I've opened it | { body } -> a reply
//   { action: "EDIT", messageId, body } / { action: "DELETE", messageId } -> the sender changes their own message
//   (Ilies 27 Oct: no approval). Every earlier text is kept in MessageVersion. PUT / PATCH / DELETE stay 405.
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
  const out = b.action === "SEEN" ? await markSeen(v.me, id) : b.action === "EDIT" ? await editMessage(v.me, id, b) : b.action === "DELETE" ? await deleteMessage(v.me, id, b) : await postMessage(v.me, id, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: b.action ? 200 : 201 });
});
