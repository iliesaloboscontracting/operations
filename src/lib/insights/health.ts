// Company health band (Phase 3 piece G1, 25 Oct 2026): six tiles across the
// top of the Directors overview, built only from what Operations already
// has - no new connection. Each tile says what it shows, a status word, its
// source, "as at" and how sure it is. Pipeline, revenue and cash say "not
// connected yet" instead of showing a number, so a missing figure is never
// read as zero. Plain functions; `npm test` (health.test.ts).
//
// Costs come from Project Tracking (loadTracking) and are never recomputed:
// contract value, forecast (spent + still to come) and each job's Watch / Act
// status are Tracking's own. "Headroom" is contract value less that forecast
// - provisional, because the forecast isn't a cost-to-complete, variations
// aren't in and revenue isn't connected. Nothing here is called margin.
import type { ProjectCostDTO } from "../types";
import type { Confidence, CostPosition } from "./kpis";
import { THRESHOLDS } from "./dictionary";

export type HealthStatus = "OK" | "WATCH" | "ACT" | "INFO" | "NOT_CONNECTED";

export interface HealthTile {
  id: "pipeline" | "workInHand" | "costVsContract" | "revenue" | "cash" | "people";
  title: string;
  status: HealthStatus;
  statusWord: string;
  headline: string | null; // the one big figure, null when not connected
  lines: string[];
  source: string;
  asAt: string | null; // ISO; null when not connected
  confidence: Confidence | null;
  confidenceWhy: string;
  missing: string | null; // what would make it better / complete
  kpi?: string; // dictionary entry for the "?"
}

export interface HealthInput {
  asAt: string;
  projects: Pick<ProjectCostDTO, "status" | "health" | "contractValue" | "forecastCost">[];
  workload: { active: number; starting: { confidence: string | null }[]; completing: unknown[] };
  // costPosition()'s job counts and still to come, so the band and the Cost section never disagree
  cost: Pick<CostPosition, "health" | "stillToCome">;
  costConfidence: Confidence;
  capacity: { available: number; shortDays: unknown[] };
  supervisorGaps: number;
  activeCrew: number;
  hours: { week: string; staff: number; hire: number; partial: boolean; incomplete: boolean }[];
}

const money = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-AU")}`;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const lower = (a: Confidence, b: Confidence): Confidence => (a === "LOW" || b === "LOW" ? "LOW" : a === "MEDIUM" || b === "MEDIUM" ? "MEDIUM" : "HIGH");

// Active jobs as Tracking counts them for contract comparisons: active, and
// not an overhead bucket (yard, office).
export function contractJobs(projects: HealthInput["projects"]) {
  const active = projects.filter((p) => p.status === "ACTIVE" && p.health !== "OVERHEAD" && p.health !== "CLOSED");
  const valued = active.filter((p) => p.contractValue != null && p.contractValue > 0);
  const contract = valued.reduce((n, p) => n + (p.contractValue ?? 0), 0);
  const forecast = valued.reduce((n, p) => n + p.forecastCost, 0);
  const headroom = valued.reduce((n, p) => n + ((p.contractValue ?? 0) - p.forecastCost), 0);
  const over = valued.filter((p) => p.forecastCost > (p.contractValue ?? 0)).length;
  return { active: active.length, valued: valued.length, noValue: active.length - valued.length, contract, forecast, headroom, over, usedPct: contract > 0 ? forecast / contract : null };
}

function notConnected(id: HealthTile["id"], title: string, source: string, missing: string, kpi: string): HealthTile {
  return { id, title, status: "NOT_CONNECTED", statusWord: "Not connected yet", headline: null, lines: [], source, asAt: null, confidence: null, confidenceWhy: "No data yet", missing, kpi };
}

export function companyHealth(i: HealthInput): HealthTile[] {
  const c = contractJobs(i.projects);
  const valuedShare = c.active > 0 ? c.valued / c.active : 1;

  // ---- work in hand ----
  const firmStarts = i.workload.starting.filter((s) => s.confidence === "CONFIRMED").length;
  const workInHand: HealthTile = {
    id: "workInHand",
    title: "Work in hand",
    status: "INFO",
    statusWord: "Provisional",
    headline: c.valued ? money(c.contract) : plural(c.active, "job"),
    lines: [
      c.noValue ? `${c.valued} of ${plural(c.active, "active job")} have a contract value` : `${plural(c.active, "active job")}, all with a contract value`,
      c.usedPct != null ? `Forecast cost uses ${Math.round(c.usedPct * 100)}% of the contract value` : "No contract values to compare against",
      `Starting in ${THRESHOLDS.startsWindowDays} days: ${i.workload.starting.length}${i.workload.starting.length ? ` (${firmStarts} confirmed)` : ""} · completing: ${i.workload.completing.length}`,
    ],
    source: "Operations: projects and Project Tracking",
    asAt: i.asAt,
    confidence: valuedShare >= 0.9 ? "MEDIUM" : "LOW",
    confidenceWhy: valuedShare >= 0.9
      ? "Contract values on nearly every active job; what's been claimed to date isn't connected yet"
      : `${plural(c.noValue, "active job")} with no contract value, so the total is understated`,
    missing: "Claimed to date (accounts) and variations",
    kpi: "W1",
  };

  // ---- cost vs contract ----
  const h = i.cost.health;
  const stillToCome = i.cost.stillToCome;
  const assessed = h.act + h.watch + h.onTrack;
  const costVsContract: HealthTile = {
    id: "costVsContract",
    title: "Cost vs contract",
    status: h.act ? "ACT" : h.watch ? "WATCH" : assessed ? "OK" : "INFO",
    statusWord: h.act ? `Act on ${plural(h.act, "job")}` : h.watch ? `Watch ${plural(h.watch, "job")}` : assessed ? "On track" : "Can't assess",
    headline: c.valued ? money(c.headroom) : null,
    lines: [
      c.valued ? `Headroom left on ${plural(c.valued, "job")} (provisional)${c.over ? ` · ${c.over} forecast over` : ""}` : "No job has a contract value yet",
      `Act ${h.act} · Watch ${h.watch} · On track ${h.onTrack} · Can't assess ${h.cantAssess}`,
      `Still to come: ${money(stillToCome)}`,
    ],
    source: "Operations: Project Tracking",
    asAt: i.asAt,
    confidence: lower(i.costConfidence, valuedShare >= 0.9 ? "MEDIUM" : "LOW"),
    confidenceWhy: "Forecast is spent + booked, not a cost-to-complete; TBC rates, uncosted lines and late labour-hire invoices move it",
    missing: h.cantAssess ? `Contract values on ${plural(h.cantAssess, "job")}` : "Variations register",
    kpi: "F12",
  };

  // ---- people ----
  const last = [...i.hours].reverse().find((w) => !w.partial) ?? null;
  const short = i.capacity.shortDays.length;
  const people: HealthTile = {
    id: "people",
    title: "People & safety",
    status: short || i.supervisorGaps ? "WATCH" : "OK",
    statusWord: short ? `Short of crew on ${plural(short, "day")}` : i.supervisorGaps ? `${plural(i.supervisorGaps, "job")} without a lead` : "Covered",
    headline: `${i.activeCrew} crew`,
    lines: [
      last && last.staff + last.hire > 0
        ? `Last week: ${Math.round(last.staff + last.hire).toLocaleString("en-AU")} hours signed (${Math.round(last.hire).toLocaleString("en-AU")} hire)${last.incomplete ? " - trial week" : ""}`
        : "No full tracked week of sign-ins yet",
      `Next ${THRESHOLDS.lookaheadDays} days: ${short ? `${plural(short, "day")} booked beyond our ${i.capacity.available} crew` : "booked crew within what we have"}${i.supervisorGaps ? ` · ${plural(i.supervisorGaps, "job")} with no supervisor or lead` : ""}`,
      "Safety: incident register not connected yet",
    ],
    source: "Operations: labour register, board, site sign-ins",
    asAt: i.asAt,
    confidence: last && !last.incomplete ? "MEDIUM" : "LOW",
    confidenceWhy: last && !last.incomplete
      ? "Hours from sign-ins; the look-ahead only covers what's booked on the board"
      : "Sign-ins are new - last week was the trial, so hours are incomplete",
    missing: "Incident register",
    kpi: "P3",
  };

  return [
    notConnected("pipeline", "Pipeline", "Lobos Estimating tender register", "Estimating's pipeline feed to this screen", "C1"),
    workInHand,
    costVsContract,
    notConnected("revenue", "Revenue & P&L", "Accounting (Xero)", "Accounts connection or monthly export", "F9"),
    notConnected("cash", "Cash & receivables", "Accounting (Xero)", "Accounts connection or monthly export", "F10"),
    people,
  ];
}
