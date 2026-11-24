// The Claude call behind "Tidy it up" (./tidy.ts), built like lib/dailyLog/voiceClean.ts: the server's existing
// ANTHROPIC_API_KEY, the same model, api.anthropic.com only (no new outbound host), one try with a timeout, and errors
// scrubbed by the caller (runTidy logs the error's kind only). What's sent: the system prompt and the draft wrapped as
// data (buildTidyPrompt) - nothing else. What comes back is text that ./tidy.ts validateTidied checks before use.
import Anthropic from "@anthropic-ai/sdk";
import { ReadingNotConfigured } from "../invoiceReading";
import { TIDY_LIMITS, type Tidier } from "./tidy";

const MODEL = "claude-opus-5-5";
// The allowlist: one host, https only. baseURL is pinned so ANTHROPIC_BASE_URL can't move it, and every request the SDK
// makes is checked just before it leaves.
const HOST = "api.anthropic.com";
const BASE_URL = `https://${HOST}`;
const allowlistedFetch: typeof fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== "https:" || url.host !== HOST) return Promise.reject(new Error("blocked host"));
  return fetch(input, init);
};

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new ReadingNotConfigured("Message tidy-up isn't set up - ANTHROPIC_API_KEY is missing from the server's environment.");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: BASE_URL, fetch: allowlistedFetch, timeout: TIDY_LIMITS.timeoutMs, maxRetries: 0 });
}

export const claudeTidier: Tidier = async ({ system, user }) => {
  const response = await client().beta.messages.create({
    model: MODEL,
    // 300 characters is well under 200 tokens; room to spare without letting it ramble.
    max_tokens: 400,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error("not tidied");
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
};
