// Reading accounts' invoice register spreadsheets (.xlsx or .csv) into plain
// rows (24 Oct 2026). Workbooks have several tabs (register, by supplier,
// by month, gaps...) - the tab that looks most like an invoice list wins.
// Every cell becomes text: dates as YYYY-MM-DD, numbers as plain digits.
import ExcelJS from "exceljs";

export type SheetRow = { rowNo: number; cells: Record<string, string> };
export type SheetTable = { sheetName: string; headers: string[]; rows: SheetRow[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return iso(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v && typeof v.text === "string") return v.text.trim(); // hyperlink
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formula
    if ("error" in v) return "";
  }
  return String(v).trim();
}

// A header row has at least four text cells and no money-looking values.
function headerScore(values: string[]) {
  const texts = values.filter((v) => v && !/^-?[\d.,$]+$/.test(v));
  return texts.length >= 4 ? texts.length : 0;
}

function bestTable(tables: SheetTable[]): SheetTable | null {
  let best: SheetTable | null = null;
  let bestScore = 0;
  for (const t of tables) {
    const h = t.headers.join(" ").toLowerCase();
    const looksLikeInvoices = /invoice/.test(h) && /(ex gst|amount|total|cost)/.test(h);
    const score = t.rows.length + (looksLikeInvoices ? 10_000 : 0);
    if (t.rows.length > 0 && score > bestScore) [best, bestScore] = [t, score];
  }
  return best;
}

// Turns a grid of text (one array per sheet row) into a header + rows table.
function tableFrom(sheetName: string, grid: string[][]): SheetTable | null {
  let headerAt = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) if (headerScore(grid[i]) > 0) { headerAt = i; break; }
  if (headerAt < 0) return null;
  const headers = grid[headerAt].map((h, i) => h || `Column ${i + 1}`);
  const rows: SheetRow[] = [];
  for (let i = headerAt + 1; i < grid.length; i++) {
    const r = grid[i];
    if (r.filter(Boolean).length < 2) continue; // blank or a lone note
    const cells: Record<string, string> = {};
    headers.forEach((h, c) => { if (r[c]) cells[h] = r[c]; });
    rows.push({ rowNo: i + 1, cells });
  }
  return { sheetName, headers, rows };
}

export type SheetGrid = { sheetName: string; grid: string[][] };

async function readXlsxGrids(buf: Buffer): Promise<SheetGrid[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: SheetGrid[] = [];
  wb.eachSheet((ws) => {
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { vals[c - 1] = cellText(cell.value); });
      grid[n - 1] = Array.from(vals, (v) => v ?? "");
    });
    out.push({ sheetName: ws.name, grid: Array.from(grid, (r) => r ?? []) });
  });
  return out;
}

// Plain CSV with quoted fields ("a, b" and "" for a quote).
function readCsvGrid(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field.trim()); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim()); grid.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field.trim()); grid.push(row); }
  return grid;
}

// Every sheet as a raw grid of text (the Xero exports reader needs the rows a
// table would drop, such as P&L section headings).
export async function readSheetGrids(buf: Buffer, fileName: string): Promise<SheetGrid[]> {
  return fileName.endsWith(".csv")
    ? [{ sheetName: "CSV", grid: readCsvGrid(buf.toString("utf8").replace(/^﻿/, "")) }]
    : readXlsxGrids(buf);
}

export function tableFromGrid(g: SheetGrid): SheetTable | null {
  return tableFrom(g.sheetName, g.grid);
}

export async function readInvoiceSheet(buf: Buffer, fileName: string): Promise<SheetTable | null> {
  const tables = (await readSheetGrids(buf, fileName)).map(tableFromGrid).filter((t): t is SheetTable => t != null);
  return bestTable(tables);
}
