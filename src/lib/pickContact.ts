import { CONTACT_TEXT_KEYS, VISIBLE_TO } from "./projectFile";

// Whitelists a ProjectContact create/update body. Blank text becomes null
// (unknown); visibleTo must be one of VISIBLE_TO and is left out when not
// given, so a new contact takes the INTERNAL schema default.
export function pickContact(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of CONTACT_TEXT_KEYS) {
    if (k in body) {
      const v = body[k];
      data[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null;
    }
  }
  if ("visibleTo" in body) {
    const v = String(body.visibleTo);
    if ((VISIBLE_TO as readonly string[]).includes(v)) data.visibleTo = v;
  }
  if ("sortOrder" in body && Number.isFinite(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder);
  return data;
}
