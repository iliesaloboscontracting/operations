import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { ASSISTANT_TOOLS, runTool } from "@/lib/assistantTools";
import { todaySydney } from "@/lib/today";

// POST /api/assistant/chat { messages: [{ role: "user"|"assistant", content: string }] }
// -> { reply: string, toolsUsed: string[] }
//
// Manager+ only, same threshold as Project Tracking - the assistant's tools
// can return cost/contract figures, so it needs the same money-guard boundary
// the rest of the app already enforces. Read-only: the assistant can look at
// live data through a fixed set of tools (see assistantTools.ts), never write.
//
// A conversation lives only in the browser tab's state - nothing is persisted
// server-side in this phase.
const SYSTEM_PROMPT = `You are the Operations assistant for Lobos Contracting, a demolition and construction company. You answer a Manager or Admin's questions about their live operational data - schedule, crew/plant allocation, project cost tracking, and the resource register.

Rules:
- Always use the tools to look up real data before answering anything about jobs, costs, resources or projects. Never guess or invent a figure, a name, or a date.
- If a tool's data doesn't answer the question, say so plainly rather than filling the gap with a guess.
- Money figures are ex GST unless the data says otherwise.
- Dates in tool results are YYYY-MM-DD. Today is ${todaySydney()} (Sydney time).
- Keep answers short and direct - this is a busy operations manager, not a report. Use a list only when there are several items to enumerate.
- You cannot create, edit, delete or assign anything. If asked to make a change, say that's not something you can do yet and that they should use the relevant page in Operations.`;

const MAX_TOOL_ROUNDS = 5;

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The assistant isn't set up yet - ANTHROPIC_API_KEY is missing from the server's environment." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const incoming = Array.isArray(body.messages) ? body.messages : null;
  if (!incoming || incoming.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = incoming.map((m: { role: string; content: string }) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie");
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: ASSISTANT_TOOLS,
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return NextResponse.json({ reply: text || "I don't have anything to add.", toolsUsed });
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolsUsed.push(block.name);
      const result = await runTool(block.name, block.input as Record<string, unknown>, origin, cookie);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result.data),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return NextResponse.json({
    reply: "That took more steps than I'm allowed - try asking a narrower question.",
    toolsUsed,
  });
});
