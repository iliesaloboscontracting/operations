// The replies the site documents routes share: the link's "not active", the kill switch, the money guard on every link
// reply, and a served file / signature with its safe headers.
import { NextResponse } from "next/server";
import { OFF_MESSAGE, SIGNATURE_HEADERS, fileHeaders, linkSafe } from "./rules";

export const dead = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
export const off = () => NextResponse.json({ error: OFF_MESSAGE, off: true }, { status: 503 });
export const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
// Every link reply passes the money guard (no dollar figure anywhere), never cached.
export const safe = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status, headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });
export const fileReply = (bytes: Buffer, mime: string, name: string) => new NextResponse(new Uint8Array(bytes), { headers: fileHeaders(mime, name) });
export const pngReply = (png: Buffer) => new NextResponse(new Uint8Array(png), { headers: SIGNATURE_HEADERS });
