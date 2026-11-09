// Vehicle & plant pre-start checklists (stage 1, Ilies approved the wording 8 Nov 2026). Versioned: a change of
// wording is a new id (truck-pre.v2), so a saved check always says which list was answered. Chosen by the machine's
// resource type - VEHICLE today; the EQUIPMENT / ATTACHMENT lists are for stage 2 (QR stickers on owned plant) and
// are not used yet. No database code here (the phone page and `npm test` read it too).

export type CheckKind = "PRE" | "POST";
export const ANSWERS = ["OK", "FAULT", "NA"] as const;
export type Answer = (typeof ANSWERS)[number];

// okLabel / faultLabel: what the two buttons say. An item worded as a question ("Any new damage today?") reads
// "No" / "Yes – report it" instead of OK / Fault, so the answer is never back to front.
export type ChecklistItem = { key: string; label: string; okLabel?: string; faultLabel?: string };
export type Checklist = { id: string; kind: CheckKind; title: string; items: ChecklistItem[] };

const QUESTION = { okLabel: "No", faultLabel: "Yes – report it" };

export const TRUCK_PRE: Checklist = {
  id: "truck-pre.v1", kind: "PRE", title: "Truck pre-start",
  items: [
    { key: "tyres", label: "Tyres and wheel nuts" },
    { key: "lights", label: "Lights, indicators and beacon" },
    { key: "brakes", label: "Brakes and park brake" },
    { key: "horn", label: "Horn and reversing alarm" },
    { key: "mirrors", label: "Mirrors, windscreen and wipers" },
    { key: "seatbelt", label: "Seatbelt" },
    { key: "fluids", label: "Oil, coolant and fuel – no warning lights" },
    { key: "leaks", label: "No leaks under the truck" },
    { key: "tipper", label: "Tipper hoist, tailgate and safety prop" },
    { key: "load", label: "Load restraint and tarp" },
    { key: "safety-kit", label: "Fire extinguisher and first-aid kit" },
    { key: "body", label: "Body damage – anything new?" },
  ],
};

export const TRUCK_POST: Checklist = {
  id: "truck-post.v1", kind: "POST", title: "Truck post-check",
  items: [
    { key: "new-damage", label: "Any new damage today?", ...QUESTION },
    { key: "driving-faults", label: "Any faults while driving?", ...QUESTION },
    { key: "tray", label: "Tray empty and tarp stowed" },
    { key: "parked", label: "Parked safely and keys returned" },
  ],
};

// Stage 2 (not used yet): owned plant and attachments.
export const PLANT_PRE: Checklist = {
  id: "plant-pre.v1", kind: "PRE", title: "Plant pre-start",
  items: [
    { key: "walk-around", label: "Walk-around – no damage or leaks" },
    { key: "hoses", label: "Hydraulic hoses and fittings" },
    { key: "tracks", label: "Tracks or tyres, rollers and sprockets" },
    { key: "fluids", label: "Engine oil, coolant, hydraulic oil and fuel" },
    { key: "greased", label: "Greased" },
    { key: "hitch", label: "Attachment, quick hitch and locking pin engaged" },
    { key: "rops", label: "ROPS/FOPS, glass and mirrors" },
    { key: "seatbelt", label: "Seatbelt" },
    { key: "lights", label: "Lights, beacon, horn and travel alarm" },
    { key: "controls", label: "Controls and isolation lever" },
    { key: "e-stop", label: "Emergency stop" },
    { key: "extinguisher", label: "Fire extinguisher" },
    { key: "warning-lights", label: "No warning lights after start-up" },
  ],
};

export const PLANT_POST: Checklist = {
  id: "plant-post.v1", kind: "POST", title: "Plant post-check",
  items: [
    { key: "damage", label: "Any damage or faults today?", ...QUESTION },
    { key: "parked", label: "Parked level, bucket down, isolated" },
    { key: "fuel", label: "Fuel level", okLabel: "OK", faultLabel: "Low – report it" },
  ],
};

export const CHECKLISTS: Record<string, Checklist> = Object.fromEntries(
  [TRUCK_PRE, TRUCK_POST, PLANT_PRE, PLANT_POST].map((c) => [c.id, c]),
);

// The list for a machine: trucks (VEHICLE) now; plant (EQUIPMENT / ATTACHMENT) once stage 2 turns it on. Anything
// else (a person, hire gear) has no checklist.
export function checklistFor(resourceType: string, kind: CheckKind, opts: { plant?: boolean } = {}): Checklist | null {
  if (resourceType === "VEHICLE") return kind === "PRE" ? TRUCK_PRE : TRUCK_POST;
  if (opts.plant && (resourceType === "EQUIPMENT" || resourceType === "ATTACHMENT")) return kind === "PRE" ? PLANT_PRE : PLANT_POST;
  return null;
}

export const okLabelOf = (i: ChecklistItem) => i.okLabel ?? "OK";
export const faultLabelOf = (i: ChecklistItem) => i.faultLabel ?? "Fault";
export const answerLabel = (i: ChecklistItem, a: Answer) => (a === "OK" ? okLabelOf(i) : a === "FAULT" ? faultLabelOf(i) : "N/A");

// Walk-around photos (stage 1b, Ilies 10 Nov 2026): five camera photos on a truck's pre-start - required on the first
// pre-start of the day for that truck, optional on later ones. The odometer photo is its own step (Receipts R1), not a
// slot here. Trucks only for now; plant (stage 2) can get its own list.
export const TRUCK_WALKAROUND = [
  { key: "FRONT", label: "Front" },
  { key: "BACK", label: "Back" },
  { key: "DRIVER", label: "Driver's side" },
  { key: "PASSENGER", label: "Passenger's side" },
  { key: "CAB", label: "Inside the cab (wide shot)" },
] as const;
export type WalkaroundSlot = (typeof TRUCK_WALKAROUND)[number]["key"];
export const walkaroundSlotsFor = (resourceType: string, kind: CheckKind): readonly { key: string; label: string }[] =>
  resourceType === "VEHICLE" && kind === "PRE" ? TRUCK_WALKAROUND : [];
export const slotLabel = (key: string | null) => TRUCK_WALKAROUND.find((s) => s.key === key)?.label ?? key ?? "";
