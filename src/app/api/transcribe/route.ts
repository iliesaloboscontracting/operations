import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/transcribe - multipart form: "audio" (the recorded audio/webm)
// and optional "vocabulary" (plain text - crew/site names likely to be
// spoken, built client-side from the board's own data).
// -> { text: string }
//
// Manager+ only, same floor as the rest of the Command Centre assistant.
// Forwards to OpenAI's transcription API (gpt-4o-mini-transcribe) - a second
// AI vendor alongside Anthropic, specifically because the browser's own
// built-in speech recognition has no way to tune for crew names (Joao,
// Roslyn, Villi, ...). gpt-4o-mini-transcribe's own "prompt" field is exactly
// that tuning mechanism (OpenAI's guidance: free text naming the proper
// nouns/vocabulary likely to appear improves recognition of names and
// domain terms) - vocabulary is folded into it here. 503s with a clear
// message if OPENAI_API_KEY isn't set, same pattern as the main assistant's
// ANTHROPIC_API_KEY check.
const MAX_PROMPT_CHARS = 1800; // generous but bounded - this is a hint, not a transcript

// The browser's actual recording format varies - Chrome/Edge/Firefox produce
// audio/webm, Safari (so an iPhone/iPad on site) produces audio/mp4. Always
// labelling the upload "command.webm" regardless would mislead OpenAI's
// format detection into trying to decode an mp4 file as webm and failing -
// so the forwarded filename's extension follows the blob's own declared
// type instead, same type the browser's MediaRecorder reported.
const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};
function filenameFor(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return `command.${EXT_BY_MIME[base] ?? "webm"}`;
}

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Voice commands aren't set up yet - OPENAI_API_KEY is missing from the server's environment." },
      { status: 503 }
    );
  }

  const incoming = await req.formData().catch(() => null);
  const audioFile = incoming?.get("audio");
  const vocabulary = incoming?.get("vocabulary");
  if (!(audioFile instanceof Blob) || audioFile.size === 0) {
    return NextResponse.json({ error: "No audio received" }, { status: 400 });
  }

  const form = new FormData();
  form.append("file", audioFile, filenameFor(audioFile.type));
  form.append("model", "gpt-4o-mini-transcribe");
  if (typeof vocabulary === "string" && vocabulary.trim()) {
    const prompt =
      "This is a spoken crew/plant assignment instruction on an Australian demolition and construction " +
      "site, naming a person or piece of plant and the job/site to send them to. Likely names: " +
      vocabulary.trim().slice(0, MAX_PROMPT_CHARS);
    form.append("prompt", prompt);
  }

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return NextResponse.json(
      { error: body?.error?.message || "Transcription failed. Try again." },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({ text: (data.text || "").trim() });
});
