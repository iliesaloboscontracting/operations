// Read-only tools the AI assistant can call (Brief: AI assistant, phase 1).
// Every tool is a thin wrapper around an existing, already-tested API route -
// never a fresh Prisma query and never raw SQL - so the assistant always sees
// exactly what a Manager would see in the UI, with the same role gating, the
// same money-guard rules, and no separate copy of business logic to drift out
// of sync. The assistant route itself is Manager+ only (see chat/route.ts),
// so these are allowed to include cost/contract figures the way Tracking does.
//
// Deliberately no write tools in this phase - the assistant can look, not
// touch. A wrong or hallucinated answer is a minor annoyance; a wrong write
// to the live board is a real operational incident, so that's out of scope
// until read-only has proven itself.

import type Anthropic from "@anthropic-ai/sdk";

export type ToolName = "get_jobs" | "get_tracking_summary" | "get_projects" | "get_resources";

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_jobs",
    description:
      "Get every job scheduled on a specific date - site, client, shift, times, day brief, and who/what is assigned (crew with role, plant, vehicles, hire), plus which jobs are stood down. Use this for 'who's on X tomorrow', 'what's running on date Y', 'does anyone need a supervisor'.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["date"],
    },
  },
  {
    name: "get_tracking_summary",
    description:
      "Get every active project's cost-to-date (plant, attachments, trucks, hire, labour-hire, own-crew labour, total), contract value where known, and idle/overdue hired items. Use this for 'what's project X cost so far', 'which jobs are over/under budget', 'what hire is sitting idle'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_projects",
    description:
      "Get the list of all projects with status (active/inactive/completed), client, job number, address and contract value. Use this for 'what projects do we have', 'is project X still active', 'who's the client for Y'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_resources",
    description:
      "Get the full resource register - crew, plant, attachments, vehicles and hire - with type, status (available/on site/down/leave), and for hire items the agency and on/off-hire dates. Use this for 'is X available', 'what plant do we have', 'what's on hire right now'.",
    input_schema: { type: "object", properties: {} },
  },
];

const PATH_FOR: Record<ToolName, (input: Record<string, unknown>) => string> = {
  get_jobs: (input) => `/api/jobs?date=${encodeURIComponent(String(input.date))}`,
  get_tracking_summary: () => `/api/tracking`,
  get_projects: () => `/api/projects`,
  get_resources: () => `/api/resources`,
};

// Executes a tool call by hitting our own API route with the caller's session
// cookie forwarded - so it's gated by the exact same guard() check and returns
// the exact same shape the real page renders from, nothing more.
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  origin: string,
  cookie: string | null
): Promise<{ ok: boolean; data: unknown }> {
  const build = PATH_FOR[name as ToolName];
  if (!build) return { ok: false, data: { error: `Unknown tool: ${name}` } };
  const res = await fetch(`${origin}${build(input)}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const data = await res.json().catch(() => ({ error: "Non-JSON response" }));
  return { ok: res.ok, data };
}
