// The QR's checks & service history routes (12 Nov 2026): the QR code is the only key - the same lookup as the scan
// (resolvePlantQr: hash, kind PLANT, switched on, still Lobos-owned plant) - then the rate limits (viewLimit.ts).
// No session, no name; only that machine's records.
import type { NextRequest } from "next/server";
import { clientIp } from "../throttle";
import { resolvePlantQr } from "./plant";
import { badCode, downloadGate, ipGate, viewGate } from "./viewLimit";

const NOT_ACTIVE = { error: "This pre-start QR isn't active. Ask the office.", status: 404 };

export async function openQr(req: NextRequest, code: string, use: "view" | "download") {
  const ip = clientIp(req.headers);
  const ipRefused = ipGate(ip);
  if (ipRefused) return ipRefused;
  let secret = code;
  try { secret = decodeURIComponent(code); } catch { /* left as is - the lookup refuses it */ }
  const q = await resolvePlantQr(secret);
  if (!q) { badCode(ip); return NOT_ACTIVE; }
  const refused = use === "view" ? viewGate(q.linkId) : downloadGate(q.linkId);
  return refused ?? { linkId: q.linkId, machineId: q.machine.id };
}
