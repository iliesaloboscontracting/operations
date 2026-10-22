// Site requests (21 Oct 2026): the request types, their few questions, the
// three priorities and how each status reads - shared by the supervisor's
// phone page, Alex's to-do list and Ilies's Requests page so they all
// describe a request the same way. No database code here (used in browsers).

export const PRIORITIES = ["URGENT", "HIGH", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { URGENT: "Urgent", HIGH: "High", LOW: "Low" };
export const PRIORITY_HINT: Record<Priority, string> = {
  URGENT: "Work stops without it - today",
  HIGH: "Needed tomorrow / within 24 hours",
  LOW: "This week, or when possible",
};
export const PRIORITY_DOT: Record<Priority, string> = { URGENT: "🔴", HIGH: "🟠", LOW: "⚪" };
export const PRIORITY_TONE: Record<Priority, string> = {
  URGENT: "border-red-500/60 bg-red-500/15 text-red-300",
  HIGH: "border-amber-500/60 bg-amber-500/15 text-amber-300",
  LOW: "border-gray-600 bg-gray-700/40 text-gray-300",
};

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: string[];
  placeholder?: string;
  required?: boolean;
};

export type RequestType = {
  kind: string;
  label: string;
  hint: string; // one line under the label on the picker
  fields: FieldDef[];
  // One-line summary from the answers, e.g. "2 x labour - asbestos ticket".
  summary: (d: Record<string, string>) => string;
  defaultPriority?: Priority;
};

const v = (d: Record<string, string>, k: string) => (d[k] ?? "").trim();
const join = (...parts: string[]) => parts.filter(Boolean).join(" - ");

export const REQUEST_TYPES: RequestType[] = [
  {
    kind: "LABOUR",
    label: "Labour",
    hint: "Extra crew for the site",
    fields: [
      { key: "count", label: "How many", type: "number", required: true, placeholder: "e.g. 2" },
      { key: "tickets", label: "Tickets / skills needed", placeholder: "e.g. operator, EWP, asbestos" },
      { key: "start", label: "Start time", placeholder: "e.g. 7am" },
      { key: "howLong", label: "How long", placeholder: "e.g. 3 days" },
    ],
    summary: (d) => join(`${v(d, "count") || "?"} x labour`, v(d, "tickets"), v(d, "howLong")),
  },
  {
    kind: "TRUCK",
    label: "Truck / load-out",
    hint: "Tipper or hook truck to load out",
    fields: [
      { key: "truck", label: "Truck", type: "select", options: ["Tipper", "Hook truck", "7-seater / ute", "Not sure"], required: true },
      { key: "loads", label: "How much", placeholder: "e.g. 2 loads, ~15 m³" },
      { key: "waste", label: "Waste type", placeholder: "e.g. GSW, concrete, mixed" },
      { key: "window", label: "Time window", placeholder: "e.g. after 10am" },
    ],
    summary: (d) => join(v(d, "truck"), v(d, "loads"), v(d, "waste")),
  },
  {
    kind: "BIN_SWAP",
    label: "Bin swap",
    hint: "Full bin to be swapped",
    fields: [{ key: "bin", label: "Which bin / what's in it", required: true, placeholder: "e.g. full hook bin, mixed waste" }],
    summary: (d) => join("Bin swap", v(d, "bin")),
  },
  {
    kind: "HIRE",
    label: "Hire - plant / equipment",
    hint: "Plant or equipment on hire",
    fields: [
      { key: "item", label: "What", required: true, placeholder: "e.g. scissor lift 19ft, 1.7t excavator" },
      { key: "howLong", label: "How long", placeholder: "e.g. 1 week" },
      { key: "delivery", label: "Delivery", type: "select", options: ["Deliver to site", "We'll collect", "Not sure"] },
    ],
    summary: (d) => join(`Hire: ${v(d, "item")}`, v(d, "howLong")),
  },
  {
    kind: "TOOLS",
    label: "Tools",
    hint: "A tool, or a replacement",
    fields: [
      { key: "item", label: "What", required: true, placeholder: "e.g. 9in grinder" },
      { key: "qty", label: "How many", type: "number", placeholder: "1" },
      { key: "replaces", label: "Replacing a faulty one?", type: "select", options: ["No", "Yes"] },
    ],
    summary: (d) => join(`${v(d, "qty") ? `${v(d, "qty")} x ` : ""}${v(d, "item")}`, v(d, "replaces") === "Yes" ? "replaces faulty" : ""),
  },
  {
    kind: "MATERIALS",
    label: "Materials / PPE",
    hint: "Bags, blades, masks, PPE",
    fields: [
      { key: "item", label: "What", required: true, placeholder: "e.g. rubble bags, P2 masks, blades" },
      { key: "qty", label: "How many", placeholder: "e.g. 2 boxes" },
    ],
    summary: (d) => join(v(d, "item"), v(d, "qty")),
  },
  {
    kind: "DELIVERY",
    label: "Delivery / pick-up",
    hint: "Move something to or from site",
    fields: [
      { key: "item", label: "What", required: true, placeholder: "e.g. jackhammer, 2 bulka bags" },
      { key: "from", label: "From", placeholder: "e.g. yard" },
      { key: "to", label: "To", placeholder: "e.g. this site" },
    ],
    summary: (d) => join(`Move: ${v(d, "item")}`, v(d, "from") && v(d, "to") ? `${v(d, "from")} -> ${v(d, "to")}` : v(d, "from") || v(d, "to")),
  },
  {
    kind: "SAFETY",
    label: "Safety / site issue",
    hint: "Unsafe, no access, work stopped",
    fields: [{ key: "issue", label: "What's the issue", required: true, placeholder: "e.g. no access, unsafe scaffold, client instruction" }],
    summary: (d) => `Site issue: ${v(d, "issue")}`,
    defaultPriority: "URGENT",
  },
  {
    kind: "DOCUMENTS",
    label: "Documents / paperwork",
    hint: "SWMS, permits, inductions",
    fields: [{ key: "what", label: "What's needed", required: true, placeholder: "e.g. SWMS, permit, plant docs, induction" }],
    summary: (d) => `Docs: ${v(d, "what")}`,
  },
  {
    kind: "OTHER",
    label: "Other",
    hint: "Anything else",
    fields: [{ key: "what", label: "What do you need", required: true }],
    summary: (d) => v(d, "what"),
  },
];
// Raised from the hire check ("finished - call it off"), not picked by hand.
export const OFF_HIRE_TYPE: RequestType = {
  kind: "OFF_HIRE",
  label: "Off-hire",
  hint: "Call off a hire item",
  fields: [{ key: "item", label: "Item", required: true }],
  summary: (d) => `Call off hire: ${v(d, "item")}`,
};
export const typeOf = (kind: string) => REQUEST_TYPES.find((t) => t.kind === kind) ?? (kind === "OFF_HIRE" ? OFF_HIRE_TYPE : undefined);

// How each status reads to the supervisor who asked.
export const STATUS_FOR_SITE: Record<string, string> = {
  SENT: "Sent",
  SEEN: "Seen by the office",
  NEEDS_INFO: "Office needs more info",
  TODO: "Approved - being actioned",
  ACTIONING: "Being actioned",
  MINE: "Approved - being actioned",
  DONE: "Done",
  CANT_DO: "Approved - being actioned",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};
// And to the office.
export const STATUS_FOR_OFFICE: Record<string, string> = {
  SENT: "New",
  SEEN: "Seen - to decide",
  NEEDS_INFO: "Waiting on supervisor",
  TODO: "With",
  ACTIONING: "On it -",
  MINE: "Doing it myself",
  DONE: "Done",
  CANT_DO: "Can't do - back to you",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};
// ACTIONING (22 Oct 2026): the person it was handed to has started on it.
export const OPEN_STATUSES = ["SENT", "SEEN", "NEEDS_INFO", "TODO", "ACTIONING", "MINE", "CANT_DO"];
// On the assignee's to-do list (Alex): handed over, started, or waiting on his question.
export const ON_TODO = ["TODO", "ACTIONING", "NEEDS_INFO"];
// Waiting on Ilies to act (the menu badge).
export const NEEDS_ILIES = ["SENT", "SEEN", "CANT_DO"];

const RANK: Record<string, number> = { URGENT: 0, HIGH: 1, LOW: 2 };
// Most urgent first, then the soonest needed-by.
export function byPriority<T extends { priority: string; neededBy: string | Date }>(a: T, b: T) {
  return (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) || new Date(a.neededBy).getTime() - new Date(b.neededBy).getTime();
}
export const requestNo = (n: number) => `R-${String(n).padStart(4, "0")}`;

// "Wed 21 Oct, 2:30pm" in Sydney time - how every request time is shown.
export function whenText(iso: string | Date) {
  return new Date(iso)
    .toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?([ap])\.?m\.?$/i, (_m, p: string) => `${p.toLowerCase()}m`);
}
// Past its do-by time and still open.
export const isOverdue = (r: { neededBy: string; status: string }) => OPEN_STATUSES.includes(r.status) && new Date(r.neededBy).getTime() < Date.now();

// The do-by time a priority starts with (the supervisor can change it):
// Urgent = in 2 hours, High = tomorrow 7am, Low = a week out at 7am.
export function defaultNeededBy(p: Priority, now = new Date()) {
  if (p === "URGENT") return new Date(now.getTime() + 2 * 3_600_000);
  const d = new Date(now);
  d.setDate(d.getDate() + (p === "HIGH" ? 1 : 7));
  d.setHours(7, 0, 0, 0);
  return d;
}
