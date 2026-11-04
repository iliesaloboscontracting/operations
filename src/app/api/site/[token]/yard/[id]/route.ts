import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { yardView } from "@/lib/siteRequests";
import { YARD_ACTIONS, isYardLink, sharedWho, type YardAction } from "@/lib/yard/rules";
import { applyYardAction, findYardJob, reread } from "@/lib/yard/store";

// PATCH /api/site/:token/yard/:id - the yard, on its shared phone link (Ilies, 4 Nov 2026):
//   { action: "ON_IT", who }                       - "On it" (stays with the yard, logged)
//   { action: "READY", who, photo, note? }         - ready for collection; photo required,
//                                                    note = anything missing / to buy elsewhere
//   { action: "CANT_DO", who, reason }             - back to the Admins to decide again
//   { action: "COLLECTED", who }                   - the supervisor picked it up
// `who` is the name typed on the phone, stored "Yard - Sam" like every shared-link action.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link || !isYardLink(link)) return NextResponse.json({ error: "No yard list on this link." }, { status: 404 });
  const r = await findYardJob(params.id);
  if (!r) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (!YARD_ACTIONS.includes(body.action)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const by = sharedWho(link.person.name, body.who);
  if (!by) return NextResponse.json({ error: "Put your name in at the top first, so the office knows who did it." }, { status: 400 });
  const out = await applyYardAction(r, body.action as YardAction, { by, linkId: link.id, photo: body.photo, note: body.note, reason: body.reason, fromYard: true });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ job: yardView((await reread(r.id))!) });
});
