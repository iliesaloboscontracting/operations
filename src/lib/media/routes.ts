// Large uploads (10 Nov 2026) - the shared body of the start / parts / complete routes. The body is a few hundred bytes
// of JSON (the file itself never comes through Operations): read with a byte count and refused over 16 KB. Every reply
// passes the money guard (no dollar figure ever reaches a link) and is never cached.
import { NextResponse, type NextRequest } from "next/server";
import { assertNoMoney } from "../moneyGuard";
import { readCapped } from "../dailyLog/voiceBody";
import { completeUpload, startUpload, uploadParts, type Party, type Reply } from "./protocol";

const MAX_BODY = 16 * 1024;
export type MediaOp = "start" | "parts" | "complete";

export async function readSmallJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_BODY) return null;
  const bytes = await readCapped(req.body, MAX_BODY);
  if (bytes === "TOO_BIG") return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

export function replyOf(r: Reply): NextResponse {
  if (!assertNoMoney(JSON.stringify(r.body))) return NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}

export const NOT_AN_UPLOAD = () => NextResponse.json({ error: "That isn't an upload request." }, { status: 413 });
export async function mediaRun(op: MediaOp, party: Party, body: Record<string, unknown>): Promise<NextResponse> {
  const r = op === "start" ? await startUpload(party, body) : op === "parts" ? await uploadParts(party, body) : await completeUpload(party, body);
  return replyOf(r);
}
export async function mediaPost(req: NextRequest, op: MediaOp, party: Party): Promise<NextResponse> {
  const body = await readSmallJson(req);
  if (!body) return NOT_AN_UPLOAD();
  return mediaRun(op, party, body);
}
export const isOp = (x: string): x is MediaOp => x === "start" || x === "parts" || x === "complete";
