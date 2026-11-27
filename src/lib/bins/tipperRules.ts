// Tipper loads (Ilies, 27 Nov 2026: "please build into the bins for the driver sections a option for the tippers we have
// within our fleet.. this allows the drivers to log waste collected in the tippers also"). His choices: per load
// "Tipper, job, waste type, photo"; charging "Yes - client's or ours", like bins; the tip docket "Suggest it, office
// confirms", the same as bins. The plain rules - no server imports, so the driver's screen, the office page and
// `npm test` (tipper.test.ts) read the same lists. The store is ./tipperStore.ts.
//
// - A load is one event: loaded at the job, then off to the tip. No on-site / picked-up, no load size, no money.
// - Only a DRIVER link logs one (a supervisor's link keeps Delivered / Picked up only).
// - The tipper is one of our own (isTipper), prefilled from the driver's truck sign-in today when that truck is a tipper.
// - LOGGED -> CANCELLED by the office with a reason; corrections are Manager+ with a reason. Nothing is deleted.
// - The tip docket is suggested with the bins' own tipCandidates and only a Manager+ confirms it.
import { assertNoMoney } from "../moneyGuard";
import { linkLabel } from "../dailyLog/money";
import { BIN_CONTENTS, OTHER, tidy, type PickedUp } from "./rules";

// ---------- which vehicles are our tippers ----------

// The rule (27 Nov 2026, from the register): a Lobos-owned (OWNED), active VEHICLE that the office has marked a tipper on
// the Bins page, or - when nobody has - whose name says "Tipper" (the register names them "Tipper - CN03RK"). The
// register's category isn't used: "Tipper" there is a register section that also holds the 7 Seater. The hook trucks
// ("Hook Truck - XO20TL", "Hino Bin Carrier - YMT57B") carry hook bins (bins already covers them) and aren't tippers
// unless the office marks one. Hired vehicles (type HIRE) are never ours.
export const TIPPER_NAME = /tipper/i;
export type FleetVehicle = { id: string; name: string; type: string; ownership: string; active: boolean };
export const isOurVehicle = (v: Pick<FleetVehicle, "type" | "ownership" | "active">) => v.type === "VEHICLE" && v.ownership === "OWNED" && v.active;
export function isTipper(v: FleetVehicle, flag: boolean | null | undefined): boolean {
  if (!isOurVehicle(v)) return false;
  return typeof flag === "boolean" ? flag : TIPPER_NAME.test(v.name);
}
// Our tippers in name order, each with why it's on (or off) the list - for the driver's picker and the office's list.
export function tipperList<T extends FleetVehicle>(vehicles: T[], flags: Map<string, boolean>) {
  return vehicles
    .filter(isOurVehicle)
    .map((v) => ({ ...v, tipper: isTipper(v, flags.get(v.id)), set: flags.has(v.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- what a phone may send ----------

export const TIPPER_USES = [
  { key: "CLIENT", label: "Client's load", hint: "the client asked for it - we're charging them" },
  { key: "OURS", label: "Our load", hint: "for our job" },
] as const;
export type TipperUse = (typeof TIPPER_USES)[number]["key"];
export const tipperUseLabel = (k: string) => TIPPER_USES.find((u) => u.key === k)?.label ?? k;
export const TIPPER_CONTENTS = BIN_CONTENTS;
export const TIPPER_STATUS_LABEL: Record<string, string> = { LOGGED: "Logged", CANCELLED: "Cancelled" };

// Daily caps per link, the bins' numbers (lib/bins/rules.ts LIMITS): 40 loads, 2 photos a load, 40 load photos a day.
export const TIPPER_LIMITS = { photosPerLoad: 2, photosPerLinkPerDay: 40, loadsPerLinkPerDay: 40 };

const ID = /^[a-z0-9]{20,40}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))] : []);

export type TipperLoadInput = { vehicleId: string; projectId: string; use: TipperUse; contents: string; contentsNote: string | null; photoIds: string[] };
// A load from a phone. Whether the tipper, the job and the photos are real (and ones this link may use) is the store's job.
export function parseTipperLoad(b: Record<string, unknown>): TipperLoadInput | { error: string } {
  const photoIds = ids(b.photoIds);
  if (photoIds.length === 0) return { error: "Take a photo of the load first." };
  if (photoIds.length > TIPPER_LIMITS.photosPerLoad) return { error: `At most ${TIPPER_LIMITS.photosPerLoad} photos.` };
  const vehicleId = id(b.vehicleId);
  if (!vehicleId) return { error: "Which tipper?" };
  const projectId = id(b.projectId);
  if (!projectId) return { error: "Which job is it from?" };
  const use = TIPPER_USES.find((u) => u.key === b.use)?.key;
  if (!use) return { error: "Client's load or our load?" };
  const contents = TIPPER_CONTENTS.find((c) => c.key === b.contents)?.key;
  if (!contents) return { error: "What's in the load?" };
  const note = tidy(b.contentsNote, 120);
  if (note && !assertNoMoney(note)) return { error: "Leave amounts off - just say what's in it." };
  if (contents === OTHER && note.length < 2) return { error: "Say what's in the load." };
  return { vehicleId, projectId, use, contents, contentsNote: note || null, photoIds };
}

// A correction from the office (Manager+): the fields to change and the reason (required). Cancel is its own action.
export type TipperCorrectionInput = { fields: Partial<{ vehicleId: string; projectId: string; use: TipperUse; contents: string; contentsNote: string | null }>; reason: string };
export function parseTipperCorrection(b: Record<string, unknown>): TipperCorrectionInput | { error: string } {
  const reason = tidy(b.reason, 300);
  if (reason.length < 3) return { error: "Say why it's being corrected." };
  if (!assertNoMoney(reason)) return { error: "Leave amounts out of the reason." };
  const fields: TipperCorrectionInput["fields"] = {};
  if (b.vehicleId !== undefined) { const v = id(b.vehicleId); if (!v) return { error: "Pick the tipper." }; fields.vehicleId = v; }
  if (b.projectId !== undefined) { const p = id(b.projectId); if (!p) return { error: "Pick the job." }; fields.projectId = p; }
  if (b.use !== undefined) { const u = TIPPER_USES.find((x) => x.key === b.use)?.key; if (!u) return { error: "Client's load or our load?" }; fields.use = u; }
  if (b.contents !== undefined) { const c = TIPPER_CONTENTS.find((x) => x.key === b.contents)?.key; if (!c) return { error: "What's in it?" }; fields.contents = c; }
  if (b.contentsNote !== undefined) {
    const n = tidy(b.contentsNote, 120);
    if (n && !assertNoMoney(n)) return { error: "No amounts in the note." };
    fields.contentsNote = n || null;
  }
  if (Object.keys(fields).length === 0) return { error: "Nothing to change." };
  return { fields, reason };
}

// The office's "is this a tipper?" switch: yes or no (until it's set, it's from the vehicle's name). A reason is optional.
export function parseTipperFlag(b: Record<string, unknown>): { tipper: boolean; reason: string | null } | { error: string } {
  if (b.tipper !== true && b.tipper !== false) return { error: "Tipper or not?" };
  const reason = tidy(b.reason, 300);
  if (reason && !assertNoMoney(reason)) return { error: "Leave amounts out of the reason." };
  return { tipper: b.tipper, reason: reason || null };
}

// ---------- the prefill from the driver's truck sign-in ----------

// Today's truck sign-ins for this person (place VEHICLE, not removed / rejected), latest first: the first that's one of
// our tippers is the prefill. None (or a ute / the hook truck) -> they pick.
export function prefillTipper(signIns: { vehicleId: string | null; signInAt: Date; status: string; removedAt: Date | null }[], tipperIds: Set<string>): string | null {
  return [...signIns]
    .filter((s) => s.vehicleId && s.status !== "REJECTED" && !s.removedAt && tipperIds.has(s.vehicleId))
    .sort((a, b) => b.signInAt.getTime() - a.signInAt.getTime())[0]?.vehicleId ?? null;
}

// ---------- the tip docket: the bins' own suggestion rules ----------

// A load as the bins' tipCandidates sees a pick-up: loaded = when it left the job, by this link / person.
export type LoadForTip = { id: string; projectId: string; loadedAt: Date; linkId: string; loadedByResourceId: string | null; tipRejectedIds?: string | null; status?: string };
export const loadAsPickUp = (l: LoadForTip): PickedUp => ({
  id: l.id, projectId: l.projectId, pickedUpAt: l.status === "CANCELLED" ? null : l.loadedAt, pickedUpLinkId: l.linkId, pickedUpByResourceId: l.loadedByResourceId, tipRejectedIds: l.tipRejectedIds ?? null,
});
// The dockets already matched to a bin entry or another load - one docket, one bin or load.
export function takenDockets(bins: { id: string; tipReceiptId: string | null }[], loads: { id: string; tipReceiptId: string | null }[], exceptLoadId?: string, exceptBinId?: string): Set<string> {
  return new Set([
    ...bins.filter((b) => b.id !== exceptBinId && b.tipReceiptId).map((b) => b.tipReceiptId!),
    ...loads.filter((l) => l.id !== exceptLoadId && l.tipReceiptId).map((l) => l.tipReceiptId!),
  ]);
}

// ---------- client's loads by job ----------

// How many client's tipper loads each job had (cancelled ones and our loads don't count). Each row is one load, or (n) a
// count from a database groupBy.
export function clientLoadCounts(rows: { projectId: string; use: string; status: string; n?: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.use !== "CLIENT" || r.status === "CANCELLED") continue;
    const n = r.n ?? 1;
    if (!(n > 0)) continue;
    out.set(r.projectId, (out.get(r.projectId) ?? 0) + n);
  }
  return out;
}

// ---------- the phone alert to Alex when a client's load is logged ----------

// Kill switches: BIN_ALERTS=off (every bins alert) or TIPPER_ALERTS=off (these only).
export const tipperAlertsOn = (env: Record<string, string | undefined> = process.env) =>
  (env.BIN_ALERTS ?? "").trim().toLowerCase() !== "off" && (env.TIPPER_ALERTS ?? "").trim().toLowerCase() !== "off";
// The link side (the "Tipper load" button and the link routes): TIPPER_LOADS=off. The office still reads and changes loads.
export const tipperLoadsOn = (env: Record<string, string | undefined> = process.env) => (env.TIPPER_LOADS ?? "").trim().toLowerCase() !== "off";
export type TipperAlert = { title: string; body: string; url: string; tag: string; silent: boolean };
// One quiet alert per client's load: words only - the job and the tipper. Our load: nothing. The tag is per job (like
// BN-008), so several loads to the same job replace one notification. Anything that would carry a dollar figure is
// never sent.
export function clientTipperAlert(l: { use: string; tipper: string; project: string; projectId: string }): TipperAlert | null {
  if (l.use !== "CLIENT") return null;
  const msg = { title: "Client's tipper load", body: `${linkLabel(l.project, "a job")}, ${linkLabel(l.tipper, "tipper")}`, url: "/bins?tab=tipper", tag: `tip-client-${l.projectId}`.slice(0, 40), silent: true };
  return assertNoMoney(JSON.stringify(msg)) ? msg : null;
}

// ---------- what a link gets back ----------

// One load on the phone: words and dates only - no price, no person.
export type TipperLinkRowDTO = { id: string; tipper: string; project: string; use: string; contents: string; at: string; status: string };
export type TipperLinkOptionsDTO = {
  tippers: { id: string; label: string }[];
  prefill: string | null; // the tipper from the driver's truck sign-in today
  projects: { id: string; label: string; mine: boolean }[];
  uses: { key: string; label: string; hint: string }[];
  contents: { key: string; label: string }[];
  today: TipperLinkRowDTO[];
};
export const timeText = (d: Date) => d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
