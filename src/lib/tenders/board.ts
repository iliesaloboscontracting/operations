// Directors -> Tenders (17 Nov 2026): the server-to-server calls to Lobos Estimating's tenders-board.v1. Server only.
// The key (BOARD_SECRET) and the acting person (x-lobos-user, from Operations' own session) are added here and
// nowhere else - a browser never reaches these Estimating routes. Who may see prices is decided by the API route
// (guardDirector), not by Estimating.
import { estimatingCall, estimatingRaw } from "../estimatingClient";
import { BOARD_SCHEMA, boardSecret, toBoardDto, type QuoteMeta } from "./rules";

export type TenderRow = {
  id: string; version: number; quoteNo: string | null; name: string; client: string | null; siteAddress: string | null;
  builders: string[]; sources: string[]; receivedDate: string | null; dueDate: string | null; status: string;
  assignee: string | null; assignReason: string | null; assignedBy: string | null;
  structuralFlag: boolean; structuralNote: string | null; workType: string | null;
  valueEstimate: number | null; submittedValue: number | null;
  quoteFile: { id: string; name: string; revision: string | null; at: string; url: string } | null;
  folderUrl: string | null; portalUrl: string | null; daysOpen: number | null; overdue: boolean; dueSoon: boolean;
};
export type PersonStats = { received: number; open: number; submitted: number; won: number; lost: number; overdue: number; hitRate: number | null; medianDaysToSubmit: number | null };
export type TendersBoardV1 = {
  schema_version: string; generated_at: string; as_at: string; period: { from: string; to: string };
  routing: { configured: boolean; people: { key: string; name: string; scope: string }[] };
  counts: Record<string, number>;
  byPerson: Record<string, PersonStats>;
  bySource: Record<string, number>;
  byWeek: { weekStart: string; received: number; submitted: number; won: number }[];
  values_ex_gst: { submitted: number | null; won: number | null; openPipeline: number | null };
  tenders: TenderRow[];
};

export type BoardState =
  | { state: "OFF" } // BOARD_SECRET not set here - the tab isn't switched on
  | { state: "UNREACHABLE" }
  | { state: "REFUSED"; status: number; code?: string; error?: string }
  | { state: "BAD_FORMAT" }
  | { state: "OK"; board: TendersBoardV1 };

export async function loadBoard(period: { from?: string; to?: string }): Promise<BoardState> {
  const key = boardSecret();
  if (!key) return { state: "OFF" };
  const q = new URLSearchParams();
  if (period.from) q.set("from", period.from);
  if (period.to) q.set("to", period.to);
  const r = await estimatingCall<TendersBoardV1>(`/api/tenders-board${q.size ? `?${q}` : ""}`, { headers: { "x-lobos-board": key }, timeoutMs: 15_000 });
  if (r.status === 0) return { state: "UNREACHABLE" };
  if (r.status !== 200 || !r.body) return { state: "REFUSED", status: r.status, code: r.body?.code, error: r.body?.error };
  if (r.body.schema_version !== BOARD_SCHEMA || !Array.isArray(r.body.tenders)) return { state: "BAD_FORMAT" };
  return { state: "OK", board: toBoardDto(r.body) }; // TND-002: the agreed fields only
}

const keyOrOff = () => boardSecret();

export async function assignTender(id: string, body: { version: number; assignee: string; reason: string }, who: string) {
  const key = keyOrOff();
  if (!key) return { status: 503, body: { error: "The Tenders link isn't switched on yet.", code: "board-key" } };
  return estimatingCall<{ tender: TenderRow }>(`/api/tenders/${encodeURIComponent(id)}/assign`, {
    method: "PUT", headers: { "content-type": "application/json", "x-lobos-board": key }, body: JSON.stringify(body),
  }, who);
}

export async function logQuote(tenderId: string | null, file: ArrayBuffer, fileName: string, meta: QuoteMeta, who: string) {
  const key = keyOrOff();
  if (!key) return { status: 503, body: { error: "The Tenders link isn't switched on yet.", code: "board-key" } };
  const path = tenderId ? `/api/tenders/${encodeURIComponent(tenderId)}/log-quote` : "/api/tenders/log-quote";
  return estimatingCall<{ tender: TenderRow; created: boolean }>(path, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream", "x-lobos-board": key,
      "x-file-name": encodeURIComponent(fileName), "x-quote-meta": encodeURIComponent(JSON.stringify(meta)),
    },
    body: file, timeoutMs: 30_000,
  }, who);
}

export async function quoteFile(tenderId: string, fileId: string) {
  const key = keyOrOff();
  if (!key) return null;
  return estimatingRaw(`/api/tenders/${encodeURIComponent(tenderId)}/quote-files/${encodeURIComponent(fileId)}`, { "x-lobos-board": key });
}
