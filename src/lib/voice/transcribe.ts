// Speech to text with OpenAI gpt-4o-mini-transcribe (29 Oct 2026) - the one place Operations talks to OpenAI.
// Used by the Command Centre's voice commands (/api/transcribe) and the site daily log's voice entry
// (/api/site/[token]/log/voice). Ilies approved keeping it on, 29 Oct 2026 (review item D13-1).
// - Only https://api.openai.com is ever called (HOST, checked before every call).
// - A timeout, so a slow call can't hold a request open.
// - Errors are scrubbed: callers get a plain message, never the key or OpenAI's own error body; the log gets the
//   status code only.
// - The audio is passed straight through from memory - nothing here writes it anywhere.
// The vocabulary prompt is the caller's: names only, never rates or prices.
export class TranscribeNotConfigured extends Error {}

const HOST = "api.openai.com";
const ENDPOINT = `https://${HOST}/v1/audio/transcriptions`;
const MODEL = "gpt-4o-mini-transcribe";
export const MAX_PROMPT_CHARS = 1800; // a hint, not a transcript

// The browser's recording format varies: Chrome / Edge / Firefox make audio/webm, Safari (an iPhone / iPad on
// site) makes audio/mp4. The filename's extension follows the blob's own type so OpenAI decodes it right.
export const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};
export const baseMime = (mime: string) => (mime || "").split(";")[0].trim().toLowerCase();
export const isAllowedAudio = (mime: string) => baseMime(mime) in EXT_BY_MIME;
export const filenameFor = (mime: string, base = "audio") => `${base}.${EXT_BY_MIME[baseMime(mime)] ?? "webm"}`;

export const transcribeConfigured = (env: { key?: string } = { key: process.env.OPENAI_API_KEY }) => !!(env.key ?? "").trim();

export type TranscribeResult = { text: string } | { error: string; status: number };
const FAILED = "Transcription failed. Try again.";

export async function transcribe(
  audio: Blob,
  opts: { prompt?: string; filename?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<TranscribeResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!transcribeConfigured({ key })) throw new TranscribeNotConfigured("Voice isn't set up - OPENAI_API_KEY is missing from the server's environment.");
  if (new URL(ENDPOINT).host !== HOST) return { error: FAILED, status: 502 }; // the allowlist: one host, no other
  const form = new FormData();
  form.append("file", audio, opts.filename ?? filenameFor(audio.type));
  form.append("model", MODEL);
  if (opts.prompt?.trim()) form.append("prompt", opts.prompt.trim().slice(0, MAX_PROMPT_CHARS));
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: timeout, redirect: "error" });
    if (!res.ok) {
      console.error("transcription failed", res.status);
      return { error: FAILED, status: 502 };
    }
    const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
    return { text: typeof data?.text === "string" ? data.text.trim() : "" };
  } catch (e) {
    console.error("transcription failed", e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
    return { error: FAILED, status: 502 };
  }
}
