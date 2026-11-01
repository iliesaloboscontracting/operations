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
import { stripMoney } from "./dailyLog/money";

export type ToolName = "get_jobs" | "get_tracking_summary" | "get_projects" | "get_resources" | "search_documents";

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
  {
    name: "search_documents",
    description:
      "Search the company's SharePoint site & safety documents (SWMS, inductions, toolbox talks, hot work permits, work plans, methodologies, checklists, waste documents, templates, drawings, programmes, meeting minutes, quality records, registers) by keywords. Returns up to 8 matches: file name, folder, revision, date and a short snippet. Use this for 'what does the SWMS for X say about Y', 'which job has a hot work permit', 'is there a methodology for Z'. Contracts, estimates and tenders are not searchable here.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A few keywords, e.g. 'asbestos removal night works'" },
      },
      required: ["query"],
    },
  },
];

const PATH_FOR: Record<ToolName, (input: Record<string, unknown>) => string> = {
  get_jobs: (input) => `/api/jobs?date=${encodeURIComponent(String(input.date))}`,
  get_tracking_summary: () => `/api/tracking`,
  get_projects: () => `/api/projects`,
  get_resources: () => `/api/resources`,
  // LCI phase 6 (Ilies, 1 Nov 2026: snippets to the Assistant): site & safety folders only (scope=site), never the
  // commercial ones - our prices never go to an AI.
  search_documents: (input) => `/api/documents?scope=site&q=${encodeURIComponent(String(input.query ?? "").slice(0, 200))}`,
};

// What a document search hands the model: the top 8, without links or paths, the highlight marks removed.
// DSO-001 (Ilies approved 1 Nov 2026 - rates never go to an AI): every dollar amount in a name or snippet becomes
// "(amount not recorded)", and spreadsheets (.xlsx / .csv - bare numbers with no "$") are left out; they stay
// searchable on the Documents page.
export function documentHits(data: unknown): unknown {
  const d = data as { off?: string; hits?: { name: string; folder: string; revision: string | null; modified: string | null; snippet: string }[] };
  if (d?.off) return { off: d.off };
  return {
    hits: (d?.hits ?? []).filter((h) => !/\.(xlsx|csv)$/i.test(h.name)).slice(0, 8).map((h) => ({
      name: stripMoney(h.name).text, folder: h.folder, revision: h.revision, modified: h.modified,
      snippet: stripMoney(h.snippet.replace(/[\u0001\u0002]/g, "")).text,
    })),
  };
}

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
  return { ok: res.ok, data: name === "search_documents" && res.ok ? documentHits(data) : data };
}
