// Activity codes v0.2, pinned (Task K, 25 Oct 2026; Ilies approved D1-D4 the same day).
// A mechanical copy of Estimating's lib/activity-codes.js - code, name, units and how the
// site reports it. No prices or rates. Codes are stable: a code never changes meaning and is
// never reused, so a daily log stays readable after the list moves on (each log stores VERSION).
// Changing this list is deliberate: activityCodes.test.ts pins the count and the waste classes.
// No server imports - the site link and the office pages both use it.

export const VERSION = "activity-codes.v0.2";

export const GROUPS: Record<string, string> = {
  GEN: "Preliminaries & site management",
  HAZ: "Hazardous materials",
  STR: "Strip-out",
  DEM: "Structural & external demolition",
  CIV: "Civil & earthworks",
  MKG: "Make good & completion"
};

export const WASTE_CLASSES = ["GSW", "VENM / ENM", "Asbestos (ACM)", "Mixed C&D", "Clean heavy (concrete / brick)", "Metal", "Recyclable"] as const;
export type WasteClass = (typeof WASTE_CLASSES)[number];

// hours: labour and plant hours by code; dockets: t or m³ by waste class; visits; count.
export type SiteReport = "hours" | "dockets" | "visits" | "count";
export type ActivityCode = { code: string; group: string; name: string; units: string[]; siteReport: SiteReport; wasteClasses?: readonly string[] };

const WASTE = WASTE_CLASSES;
const c = (code: string, name: string, units: string[], siteReport: SiteReport, wasteClasses?: readonly string[]): ActivityCode =>
  ({ code, group: code.slice(0, 3), name, units, siteReport, ...(wasteClasses ? { wasteClasses } : {}) });

export const CODES: ActivityCode[] = [
  c("GEN-01", "Mobilise / demobilise plant (floats)", ["each"], "hours"),
  c("GEN-02", "Site establishment: hoarding, fencing, exclusion zones, amenities", ["item"], "hours"),
  c("GEN-03", "Site supervision & management on site", ["days", "shifts"], "hours"),
  c("GEN-04", "Demolition plan, SWMS, notifications, inductions", ["item"], "hours"),
  c("GEN-05", "Traffic management", ["item", "days"], "hours"),
  c("GEN-06", "Environmental controls: dust, noise, sediment, wheel wash; silica dust management", ["item", "days"], "hours"),
  c("GEN-07", "Survey, set-out, as-builts", ["item"], "visits"),
  c("GEN-08", "Access equipment & cranage (EWP, scissor, boom, scaffold, crane)", ["days", "wk"], "hours"),
  c("GEN-09", "Protection of retained areas & finishes", ["m²", "item"], "hours"),
  c("GEN-10", "Out-of-hours, night & staging premium", ["shifts", "item"], "hours"),
  c("GEN-11", "Travel & accommodation", ["nights", "item"], "hours"),
  c("GEN-12", "Day labour, housekeeping & standby", ["hours"], "hours"),
  c("GEN-13", "Relocate, store & salvage client items (incl. inventory)", ["each", "item"], "hours"),
  c("GEN-14", "Confined space entry & clean-out", ["hours", "item"], "hours"),
  c("HAZ-01", "Bonded (non-friable) asbestos removal", ["m²"], "hours"),
  c("HAZ-02", "Friable asbestos removal (enclosure)", ["m²"], "hours"),
  c("HAZ-03", "Lead paint / lead dust removal", ["m²"], "hours"),
  c("HAZ-04", "Other hazmat: PCB capacitors, ODS refrigerant, SMF", ["each"], "hours"),
  c("HAZ-05", "Air monitoring, clearance inspections & certificates", ["each"], "visits"),
  c("STR-01", "Soft strip: fixtures, fittings, joinery, loose items", ["each", "item", "room", "m²"], "hours"),
  c("STR-02", "Ceiling removal (grid, plasterboard, insulation)", ["m²", "lm"], "hours"),
  c("STR-03", "Partition and stud wall removal", ["m²", "lm"], "hours"),
  c("STR-04", "Floor finishes removal (carpet, vinyl, tiles, raised floor, screed)", ["m²", "lm", "each"], "hours"),
  c("STR-05", "Services strip-out after isolation by others", ["m²"], "hours"),
  c("STR-06", "Shopfront, façade and glazing removal", ["m²"], "hours"),
  c("STR-07", "Wall finishes removal (wall tiles, splashbacks, linings)", ["m²"], "hours"),
  c("STR-08", "Cool-room / insulated panel walls & ceilings", ["m²"], "hours"),
  c("STR-09", "Balustrades, handrails & guard rails", ["lm"], "hours"),
  c("STR-10", "Doors, frames & roller shutters", ["each"], "hours"),
  c("STR-11", "Floor grinding & adhesive removal", ["m²"], "hours"),
  c("STR-12", "Screed & toppings removal as a separate operation (depth-sensitive)", ["m²", "m³", "t"], "hours"),
  c("DEM-01", "Roof removal", ["m²"], "hours"),
  c("DEM-02", "Machine demolition of light / low-rise structures", ["m²"], "hours"),
  c("DEM-03", "Concrete-frame / multi-storey demolition", ["m³"], "hours"),
  c("DEM-04", "Masonry and block wall demolition", ["m²", "lm"], "hours"),
  c("DEM-05", "Slab, path and pavement break-out", ["m²", "m³"], "hours"),
  c("DEM-06", "Footings, pits, tanks and below-ground structures", ["m³"], "hours"),
  c("DEM-07", "Saw cutting and core drilling", ["lm", "each"], "hours"),
  c("DEM-08", "Propping and temporary works", ["each", "lm", "days"], "hours"),
  c("DEM-09", "Tree and vegetation removal", ["each"], "hours"),
  c("DEM-10", "Waste load-out and haulage (tracked separately)", ["t", "m³", "bins"], "dockets", WASTE),
  c("DEM-11", "Openings in existing walls, precast & tilt panels", ["each"], "hours"),
  c("DEM-12", "Structural steel removal (beams, columns, gantries)", ["each", "t"], "hours"),
  c("CIV-01", "Clearing, grubbing, topsoil strip", ["m²", "m³"], "hours"),
  c("CIV-02", "Bulk excavation and export", ["m³"], "dockets", WASTE),
  c("CIV-03", "Detailed / footing excavation", ["m³"], "hours"),
  c("CIV-04", "Rock excavation (hammer, rock saw)", ["m³"], "hours"),
  c("CIV-05", "Imported fill, backfill and compaction", ["m³", "t"], "dockets"),
  c("CIV-06", "Trenching and underground services", ["lm"], "hours"),
  c("CIV-07", "Pits, headwalls and GPTs", ["each"], "hours"),
  c("CIV-08", "Subgrade and pavement layers", ["m²"], "hours"),
  c("CIV-09", "Civil concrete: slabs, footings, kerb", ["m³", "m²"], "hours"),
  c("CIV-10", "Shoring and dewatering", ["days"], "hours"),
  c("CIV-11", "Bored piers & piling", ["each", "lm"], "count"),
  c("CIV-12", "Capping beams & retaining walls", ["lm"], "hours"),
  c("CIV-13", "Non-destructive digging, service locating & slab scanning", ["visits", "item"], "visits"),
  c("CIV-14", "Testing & inspections (geotech, compaction, hold points)", ["visits", "item"], "visits"),
  c("CIV-15", "Formwork, reinforcement & dowels", ["m²", "kg", "each"], "hours"),
  c("CIV-16", "Permanent fencing, bollards & drainage fixtures (supply & install)", ["lm", "each"], "hours"),
  c("MKG-01", "Make good: patch and prepare for new finishes", ["m²"], "hours"),
  c("MKG-02", "Final clean, handover and dilapidation sign-off", ["item"], "hours"),
];

export const BY_CODE: Record<string, ActivityCode> = Object.fromEntries(CODES.map((x) => [x.code, x]));
export const isCode = (code: string) => Object.prototype.hasOwnProperty.call(BY_CODE, code);
export const codeLabel = (code: string) => (BY_CODE[code] ? `${code} ${BY_CODE[code].name}` : code);
