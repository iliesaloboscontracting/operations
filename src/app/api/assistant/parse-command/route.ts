import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/assistant/parse-command { transcript: string }
// -> { people: string[], jobName: string }
//
// Manager+ only. This is deliberately the ONLY thing Claude does for the
// Command Centre voice assistant: turn a spoken sentence into a plain list of
// names and a job name. It never sees the resource register or the board, has
// no tools, and cannot write anything - matching those names to real
// resourceIds/jobIds, and actually creating the assignments, happens
// afterwards in plain client-side code (src/lib/matchCommand.ts) against data
// the Command Centre already has loaded, reusing the exact same
// POST /api/assignments call a drag-and-drop does. Keeping the LLM step this
// narrow is what makes "wrong person assigned" reviewable - it's a
// fuzzy-match problem on a known list, not an open-ended agentic action.
const SYSTEM_PROMPT = `You turn a spoken instruction from a demolition/construction operations manager into a structured assignment request. The instruction will name one or more people (and/or plant/equipment) and one job or site to send them to.

Always call propose_assignment, once, with:
- people: every person/plant name mentioned, as spoken (don't correct spelling, don't guess a full name - just split the list as said). Short first names are normal and expected (e.g. "Joao", "Sam", "Villi").
- jobName: the job or site name mentioned, as spoken.

If the instruction doesn't look like a crew/plant assignment at all, call propose_assignment with empty people and an empty jobName.`;

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_assignment",
  description: "Record the people/plant and the job extracted from the instruction.",
  input_schema: {
    type: "object",
    properties: {
      people: { type: "array", items: { type: "string" }, description: "Names as spoken" },
      jobName: { type: "string", description: "Job or site name as spoken" },
    },
    required: ["people", "jobName"],
  },
};

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
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: "tool", name: "propose_assignment" },
    messages: [{ role: "user", content: transcript }],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (block?.input ?? {}) as { people?: unknown; jobName?: unknown };
  const people = Array.isArray(input.people) ? input.people.filter((p): p is string => typeof p === "string") : [];
  const jobName = typeof input.jobName === "string" ? input.jobName : "";

  return NextResponse.json({ people, jobName });
});
