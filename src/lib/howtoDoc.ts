// The supervisors' one-page how-to (Task L, 25 Oct 2026): reads the small
// Markdown subset docs/lci/SUPERVISOR-DAILY-LOG-HOWTO.md is written in -
// "# " title, "## " headings, paragraphs, "- " bullets (indented ones nest),
// "1. " steps with continuation lines, **bold** and *italic* - into blocks
// the PDF draws. The doc stays the one source: edit it, the printout follows.
// The italic note under the title is for the office and is left out.
// No server imports; `npm test` (howtoDoc.test.ts).

export type Run = { text: string; bold?: boolean; italic?: boolean };
export type Item = { runs: Run[]; children: Item[] };
export type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "para"; runs: Run[] }
  | { kind: "bullets"; items: Item[] }
  | { kind: "steps"; items: Item[] };

// **bold** and *italic* inside a line.
export function runs(text: string): Run[] {
  const out: Run[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push(m[1] != null ? { text: m[1], bold: true } : { text: m[2], italic: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

export function parseHowto(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let afterTitle = false;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    if (t.startsWith("# ")) { blocks.push({ kind: "title", text: t.slice(2).trim() }); afterTitle = true; i++; continue; }
    if (t.startsWith("## ")) { blocks.push({ kind: "heading", text: t.slice(3).trim() }); afterTitle = false; i++; continue; }

    const bullet = /^- /.test(t), step = /^\d+\. /.test(t);
    if (bullet || step) {
      // A list: items at this indent; deeper "- " lines nest under the last item; other
      // indented lines continue the item's text.
      const base = indentOf(line);
      const items: Item[] = [];
      while (i < lines.length && lines[i].trim()) {
        const l = lines[i], lt = l.trim(), ind = indentOf(l);
        if (ind === base && (bullet ? /^- /.test(lt) : /^\d+\. /.test(lt))) {
          items.push({ runs: runs(lt.replace(/^(- |\d+\. )/, "")), children: [] });
        } else if (ind > base && /^- /.test(lt) && items.length) {
          items[items.length - 1].children.push({ runs: runs(lt.slice(2)), children: [] });
        } else if (ind > base && items.length) {
          const last = items[items.length - 1];
          const target = last.children.length ? last.children[last.children.length - 1] : last;
          target.runs.push(...runs(" " + lt));
        } else break;
        i++;
      }
      blocks.push({ kind: bullet ? "bullets" : "steps", items });
      afterTitle = false;
      continue;
    }

    // A paragraph: lines up to a blank line or the start of something else.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,2} |- |\d+\. )/.test(lines[i].trim())) para.push(lines[i++].trim());
    const text = para.join(" ");
    if (afterTitle && /^\*[^*].*\*$/.test(text)) { afterTitle = false; continue; } // the office's note under the title
    afterTitle = false;
    blocks.push({ kind: "para", runs: runs(text) });
  }
  return blocks;
}

// The PDF's built-in Helvetica only has the Windows-1252 characters: swap the
// few others the doc uses (the − of "− / +", ✓, arrows) for ones it has.
export const pdfSafe = (s: string) =>
  s.replace(/−/g, "-").replace(/\s?✓/g, "").replace(/→/g, "->").replace(/[←-⇿✀-➿]/g, "");
