import { fmtDay } from "./dates";
import { quoteOfDay } from "./stoicQuotes";

// Builds the "Labour, Site & Truck Allocations" broadcast the guys get every shift -
// one message covering every running job for the day, in the crew's own format
// (WhatsApp-style *bold* + emoji section headers). Truck/driver movements aren't
// tracked anywhere in the app, so that section is left as a blank for a supervisor
// to fill in before it goes out.
//
// This goes straight to the whole crew, so it must never carry a pay rate or
// cost figure (Phase 6 money-guard). DaySheetJob/DaySheetAssignment only
// expose the fields this file actually needs - a caller can't accidentally
// pass dailyRateExGst/hireRate/payRate through even by widening a type,
// because the resource shape here simply doesn't have them. assertNoMoney
// (lib/moneyGuard.ts) is the second, independent check: a scan of the
// rendered text itself, since a supervisor can freely edit the draft before
// it's sent.

export interface DaySheetResource {
  name: string;
  type: string;
  category: string | null;
  identifier: string | null;
  agency: string | null;
}

export interface DaySheetAssignment {
  role: string | null;
  resource: DaySheetResource;
}

export interface DaySheetJob {
  title: string;
  client: string | null;
  siteAddress: string | null;
  startTime: string | null;
  endTime: string | null;
  shift: string;
  notRunning: boolean;
  dayBrief: string | null;
  assignments: DaySheetAssignment[];
}

const RULE = "━".repeat(20); // ━━━━━━━━━━━━━━━━━━━━

function isSupervisor(role: string | null) {
  return role === "Supervisor" || role === "Lead";
}
function isCrew(type: string, category: string | null) {
  return type === "PERSONNEL" || (type === "HIRE" && category === "LABOUR");
}
function isVehicle(type: string, category: string | null) {
  return type === "VEHICLE" || (type === "HIRE" && category === "VEHICLE");
}
function isPlant(type: string, category: string | null) {
  // Hired equipment and tools (21 Oct 2026) sit with plant on the day sheet.
  return type === "EQUIPMENT" || type === "ATTACHMENT" || (type === "HIRE" && (category === "PLANT" || category === "EQUIPMENT" || category === "TOOLS" || category === "WET_HIRE"));
}

function bullets(lines: string[]) {
  return lines.map((l) => `• ${l}`).join("\n");
}

// A day brief written as one line per point becomes one bullet per line; a single
// paragraph is split on sentence boundaries instead.
function briefBullets(brief: string | null) {
  if (!brief) return [];
  const byLine = brief.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (byLine.length > 1) return byLine;
  return brief.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function hiredTag(a: DaySheetAssignment) {
  return a.resource.type === "HIRE" ? ` (${a.resource.agency || "hired"})` : "";
}

function jobBlock(job: DaySheetJob, n: number) {
  const lines: string[] = [];
  const header = job.client ? `${job.title} — ${job.client}` : job.title;
  lines.push(`*${n}. ${header}*`);
  if (job.siteAddress) lines.push(`📍 ${job.siteAddress}`);
  if (job.startTime || job.endTime) lines.push(`⏰ ${job.startTime ?? "?"} - ${job.endTime ?? "?"}`);

  const supervisors: string[] = [];
  const crew: string[] = [];
  const plant: string[] = [];
  const vehicles: string[] = [];

  for (const a of job.assignments) {
    const r = a.resource;
    if (isCrew(r.type, r.category)) {
      const name = `${r.name}${hiredTag(a)}`;
      (isSupervisor(a.role) ? supervisors : crew).push(name);
    } else if (isVehicle(r.type, r.category)) {
      const label = r.identifier ? `${r.name} - ${r.identifier}` : r.name;
      vehicles.push(`${label}${hiredTag(a)}`);
    } else if (isPlant(r.type, r.category)) {
      plant.push(`${r.name}${hiredTag(a)}`);
    }
  }

  if (supervisors.length) lines.push("", `*Supervisor${supervisors.length > 1 ? "s" : ""}:*`, bullets(supervisors));
  lines.push("", `*Crew (${crew.length}):*`, crew.length ? bullets(crew) : "• No crew assigned yet");
  if (plant.length) lines.push("", "*Plant / Equipment:*", bullets(plant));
  if (vehicles.length) lines.push("", "*Vehicles:*", bullets(vehicles));

  const brief = briefBullets(job.dayBrief);
  if (brief.length) {
    lines.push("", `📋 *${job.shift === "NIGHT" ? "Night" : "Day"} brief:*`, bullets(brief));
  }

  return lines.join("\n");
}

export function buildDaySheet(jobs: DaySheetJob[], date: string) {
  const running = jobs.filter((j) => !j.notRunning);
  const day = running.filter((j) => j.shift === "DAY");
  const night = running.filter((j) => j.shift === "NIGHT");
  const stoodDown = jobs.filter((j) => j.notRunning);

  const dateLabel = fmtDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const issuedTime = new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  const q = quoteOfDay(date);

  const parts: string[] = [];

  parts.push(`*LABOUR, SITE & TRUCK ALLOCATIONS*\n*${dateLabel.toUpperCase()}*`);
  parts.push(`PROVISIONAL — confirm with Management before you act on a change.\nIssued ${issuedTime}`);

  parts.push(
    [
      RULE,
      "⚠️ *ABSENCES & ATTENDANCE*",
      "",
      "Give Management as much notice as you possibly can if you cannot attend your allocated shift.",
      "",
      "A late call changes crew numbers, transport, site programmes and what we have promised the client — all on the morning, when none of it can be fixed.",
    ].join("\n")
  );

  parts.push(
    [RULE, "⚔️ *STOIC QUOTE OF THE DAY*", "", `"${q.quote}"`, "", `— ${q.author} · ${q.source}`].join("\n")
  );

  parts.push(
    [
      RULE,
      "🦺 *PPE*",
      "",
      "Full PPE is mandatory on every site.",
      "",
      "Turn up ready to work with your own PPE, plus anything task-specific listed under your site.",
      "",
      "Supervisors are responsible for enforcing it.",
    ].join("\n")
  );

  parts.push(
    [
      RULE,
      "📲 *DAILY PROGRESS LOGGING*",
      "",
      "All Supervisors are required to log their daily site progress through the AI Logging System before finishing their shift.",
      "",
      "Daily logs are to include:",
      bullets([
        "Progress achieved",
        "Delays or access issues",
        "Variations",
        "Incidents or safety concerns",
        "Plant or labour issues",
        "Anything affecting the programme",
      ]),
    ].join("\n")
  );

  if (day.length) {
    parts.push([RULE, "☀️ *DAY SHIFT*"].join("\n"));
    day.forEach((job, i) => parts.push(jobBlock(job, i + 1)));
  }
  if (night.length) {
    parts.push([RULE, "🌙 *NIGHT SHIFT*"].join("\n"));
    night.forEach((job, i) => parts.push(jobBlock(job, i + 1)));
  }
  if (!day.length && !night.length) {
    parts.push([RULE, "No jobs scheduled for this date."].join("\n"));
  }

  parts.push(
    [RULE, "🚛 *TRUCK & DRIVER ALLOCATIONS*", "", "[Add driver movements / instructions here]"].join("\n")
  );

  if (stoodDown.length) {
    parts.push([RULE, `Not running today: ${stoodDown.map((j) => j.title).join(", ")}`].join("\n"));
  }

  parts.push(
    [
      RULE,
      "📋 *GENERAL SITE & DRIVER REQUIREMENTS*",
      "",
      "*Supervisors:*",
      "Confirm your crew and ensure everyone knows where they are going and what time they start.",
      "",
      "*Daily Progress Logs:*",
      "All Supervisors must complete their AI Logging System daily progress report before finishing their shift.",
      "",
      "*Tools:*",
      "Check everything required for your site before leaving the yard. If you are unsure, contact Management before departure.",
      "",
      "*Drivers:*",
      "Complete your vehicle pre-start before departure. Ring the relevant Site Supervisor before arrival where required.",
      "",
      "*Transport:*",
      "All plant, attachments, bins, tools and loads must be correctly restrained and secured before movement.",
      "",
      "*Changes:*",
      "Report any delay, access issue, breakdown or anything affecting the programme immediately.",
      "",
      "*Safety:*",
      "Safety comes before programme and before production. Every time.",
    ].join("\n")
  );

  const subject = `Labour, Site & Truck Allocations – ${fmtDay(date, { weekday: "short", day: "numeric", month: "short" })}`;
  return { subject, body: parts.join("\n\n") };
}

export function mailtoUrl(subject: string, body: string) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
