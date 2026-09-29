"use client";

import { useEffect, useRef, useState } from "react";
import PageShell from "@/components/PageShell";
import { Send, Sparkles } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "Who's on Bronte tomorrow?",
  "What's Myers cost to date?",
  "Any jobs missing a supervisor today?",
  "What hire is sitting idle right now?",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;
    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: body.error ?? "Something went wrong.", error: true }]);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: body.reply, toolsUsed: body.toolsUsed }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the assistant. Try again.", error: true }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <PageShell
      title="Assistant"
      subtitle="Ask about live jobs, costs, projects and resources. Read-only — it can't change anything on the board."
    >
      <div className="flex h-[calc(100%-4rem)] flex-col rounded-lg border border-edge bg-panel">
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Sparkles className="text-gray-600" size={28} />
              <div className="text-sm text-gray-500">Ask a question about today's board, a project's cost, or the resource register.</div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-edge bg-panel2 px-3 py-1.5 text-xs text-gray-300 hover:border-brand-500/60 hover:text-gray-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-brand-600 text-white"
                        : m.error
                        ? "border border-red-500/40 bg-red-950/30 text-red-300"
                        : "bg-panel2 text-gray-100"
                    }`}
                  >
                    {m.content}
                    {!!m.toolsUsed?.length && (
                      <div className="mt-1.5 text-[10px] uppercase tracking-wide text-gray-500">
                        Looked up: {m.toolsUsed.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-panel2 px-3 py-2 text-sm text-gray-500">Thinking…</div>
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-edge p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a job, a project's cost, or a resource..."
            className="flex-1 rounded-md border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            <Send size={14} />
            Ask
          </button>
        </form>
      </div>
    </PageShell>
  );
}
