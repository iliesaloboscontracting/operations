import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { viewJson } from "@/lib/coordinatorView";
import { itemHistory, updateItem } from "@/lib/inventory/store";

// One consumables item (Yard Stage C, Ilies 4 Nov 2026), Tools access (lib/auth.ts guardTools).
// GET   -> { item, movements } - its history, newest first (who, when, in / out / count, the site or yard job)
// PATCH { name?, category?, unit?, minLevel?, location?, active? } - edit, retire (active false) or bring back.
// There is no DELETE: an item is retired, never removed, so its history stays.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guardTools("VIEWER");
  if (denied) return denied;
  const h = await itemHistory(params.id);
  if (!h) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return viewJson(h);
});

export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const out = await updateItem(params.id, await req.json().catch(() => ({})), { id: user.id, name: user.name });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return viewJson(out);
});
