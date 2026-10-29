// The voice recording's request body, read with a byte count (security review SEC-011): if Content-Length isn't
// there (it may not survive every proxy), the body is read as a stream and stopped as soon as it passes the limit -
// it is never read in full first. No server imports; `npm test` (voice.test.ts).
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array<ArrayBuffer> | "TOO_BIG"> {
  if (!body) return new Uint8Array(new ArrayBuffer(0));
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return "TOO_BIG"; }
    parts.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(size));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
