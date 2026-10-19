// Compares what a toolbox photo shows (lib/toolVision.ts) with what should be
// in that toolbox. Plain code, no AI: a tool is identified exactly by its LOB
// tag or its serial number; brand + model alone only counts as "probably"
// (two identical drills can't be told apart without a tag or plate).

import type { ToolboxReading } from "./toolVision";

export type CheckTool = {
  id: string;
  tag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  toolboxId: string | null;
  toolboxName: string | null; // the toolbox it belongs in, null = yard / unassigned
};

export type CheckLine = {
  toolId: string;
  tag: string;
  name: string;
  serialNumber: string | null;
  how: "tag" | "serial" | "model";
  belongsTo?: string | null; // for tools from another toolbox
};

export type CheckResult = {
  present: CheckLine[]; // expected here, identified by tag or serial
  presentUnconfirmed: CheckLine[]; // expected here, matched on brand + model only
  missing: CheckLine[]; // expected here, not seen
  foreign: CheckLine[]; // identified by tag or serial, but belongs elsewhere
  unknown: { description: string; brand: string; model: string; lobTag: string; serialNumber: string; possibly: string[] }[];
  notes: string;
};

export const normSerial = (s: string | null | undefined) => (s ?? "").replace(/[\s\-./]/g, "").toUpperCase();

// "LOB-0012", "LOB0012", "lob 12" -> "LOB-0012"
export function normTag(s: string | null | undefined) {
  const m = (s ?? "").toUpperCase().match(/LOB[\s\-_]*0*(\d{1,6})/);
  return m ? `LOB-${m[1].padStart(4, "0")}` : "";
}

const normText = (s: string | null | undefined) => (s ?? "").replace(/[\s\-]/g, "").toUpperCase();

export function compareToolbox(toolboxId: string, reading: ToolboxReading, tools: CheckTool[]): CheckResult {
  const byTag = new Map(tools.map((t) => [normTag(t.tag), t]));
  const bySerial = new Map(tools.filter((t) => normSerial(t.serialNumber)).map((t) => [normSerial(t.serialNumber), t]));
  const expected = tools.filter((t) => t.toolboxId === toolboxId);
  const seen = new Set<string>();
  const line = (t: CheckTool, how: CheckLine["how"]): CheckLine => ({
    toolId: t.id, tag: t.tag, name: t.name, serialNumber: t.serialNumber, how,
  });

  const result: CheckResult = { present: [], presentUnconfirmed: [], missing: [], foreign: [], unknown: [], notes: reading.notes };
  const modelOnly: ToolboxReading["items"] = [];

  // 1. Exact identification: tag first, then serial number.
  for (const item of reading.items) {
    const tag = normTag(item.lobTag);
    const serial = normSerial(item.serialNumber);
    const viaTag = tag ? byTag.get(tag) : undefined;
    const viaSerial = serial ? bySerial.get(serial) : undefined;
    const tool = viaTag ?? viaSerial;
    if (!tool || seen.has(tool.id)) {
      if (!tool) modelOnly.push(item);
      continue;
    }
    seen.add(tool.id);
    const how = viaTag ? "tag" : "serial";
    if (tool.toolboxId === toolboxId) result.present.push(line(tool, how));
    else result.foreign.push({ ...line(tool, how), belongsTo: tool.toolboxName });
  }

  // 2. Brand + model only: pair with an expected tool of the same model that
  // hasn't been accounted for yet. Otherwise it's unknown - and we say which
  // toolboxes have that model, as a hint.
  for (const item of modelOnly) {
    const m = normText(item.model);
    const b = normText(item.brand);
    const sameModel = (t: CheckTool) => !!m && normText(t.model).includes(m) && (!b || !t.brand || normText(t.brand) === b);
    const candidate = m ? expected.find((t) => !seen.has(t.id) && sameModel(t)) : undefined;
    if (candidate) {
      seen.add(candidate.id);
      result.presentUnconfirmed.push(line(candidate, "model"));
    } else {
      const possibly = Array.from(
        new Set(tools.filter((t) => t.toolboxId !== toolboxId && sameModel(t)).map((t) => t.toolboxName ?? "Yard"))
      );
      result.unknown.push({ ...item, possibly });
    }
  }

  // 3. Whatever should be here and wasn't seen.
  for (const t of expected) if (!seen.has(t.id)) result.missing.push(line(t, "tag"));
  return result;
}
