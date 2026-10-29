import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { MAX_PROMPT_CHARS, filenameFor, transcribe, transcribeConfigured } from "@/lib/voice/transcribe";

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
// The OpenAI call itself (host allowlist, timeout, scrubbed errors) is the shared lib/voice/transcribe.ts, also used
// by the site daily log's voice entry.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;

  if (!transcribeConfigured()) {
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

  const prompt = typeof vocabulary === "string" && vocabulary.trim()
    ? "This is a spoken crew/plant assignment instruction on an Australian demolition and construction " +
      "site, naming a person or piece of plant and the job/site to send them to. Likely names: " +
      vocabulary.trim().slice(0, MAX_PROMPT_CHARS)
    : undefined;
  const out = await transcribe(audioFile, { prompt, filename: filenameFor(audioFile.type, "command") });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ text: out.text });
});
