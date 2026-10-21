// Prints a list of site requests (or saves it as PDF from the print dialog):
// used by Alex's to-do list and the office Requests page. Browser only.
import { PRIORITY_LABEL, STATUS_FOR_OFFICE, requestNo, whenText, type Priority } from "./requestTypes";

type Row = {
  number: number;
  priority: Priority;
  neededBy: string;
  site: string;
  summary: string;
  note: string | null;
  requestedBy: string;
  createdAt: string;
  status: string;
  officeNote?: string | null;
  answer?: string | null;
  assigneeName?: string | null;
  outcome?: string | null;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function printRequests(title: string, rows: Row[]) {
  const w = window.open("", "_blank");
  if (!w) return alert("Allow pop-ups for Operations to print the list.");
  const body = rows
    .map((r) => {
      const extra = [
        r.note && `Supervisor: ${r.note}`,
        r.answer && `Answer: ${r.answer}`,
        r.officeNote && `Office note: ${r.officeNote}`,
        r.outcome && `Outcome: ${r.outcome}`,
      ].filter(Boolean) as string[];
      return `<tr class="p-${r.priority}">
  <td><b>${PRIORITY_LABEL[r.priority]}</b></td>
  <td>${esc(whenText(r.neededBy))}</td>
  <td>${esc(r.site)}</td>
  <td><b>${esc(r.summary)}</b>${extra.map((x) => `<div class="x">${esc(x)}</div>`).join("")}</td>
  <td>${esc(r.requestedBy)}<div class="x">${esc(whenText(r.createdAt))}</div></td>
  <td>${requestNo(r.number)}<div class="x">${esc(STATUS_FOR_OFFICE[r.status] ?? r.status)}${r.status === "TODO" && r.assigneeName ? ` ${esc(r.assigneeName)}` : ""}</div></td>
  <td class="tick"></td>
</tr>`;
    })
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2mm; } .sub { color: #555; margin-bottom: 4mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; } .x { color: #555; font-size: 11px; margin-top: 2px; }
  tr.p-URGENT td:first-child { background: #fdd; } tr.p-HIGH td:first-child { background: #fed; }
  td.tick { width: 18mm; }
</style></head><body>
  <h1>${esc(title)}</h1>
  <div class="sub">Printed ${esc(whenText(new Date()))} · ${rows.length} request${rows.length === 1 ? "" : "s"} · most urgent first</div>
  <table><thead><tr><th>Priority</th><th>Do by</th><th>Site</th><th>What</th><th>Requested by</th><th>Ref</th><th>Done</th></tr></thead>
  <tbody>${body || `<tr><td colspan="7">Nothing on the list.</td></tr>`}</tbody></table>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  w.document.close();
}
