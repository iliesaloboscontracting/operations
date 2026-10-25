import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { parseHowto, pdfSafe, type Block, type Item, type Run } from "./howtoDoc";

// The supervisors' daily log how-to as one A4 page (Task L, 25 Oct 2026),
// drawn from docs/lci/SUPERVISOR-DAILY-LOG-HOWTO.md in the same plain style as
// the Scope of Works PDF (lib/scopePdf.tsx). It never carries a link: each
// supervisor opens the link they already have (a link is the key to their
// site page, so it is never printed or sent around).

const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 44, paddingHorizontal: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { borderBottom: "2pt solid #111111", paddingBottom: 7, marginBottom: 9, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  company: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  docLabel: { fontSize: 8, color: "#555555", textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  linkBox: { border: "1pt solid #111111", borderRadius: 3, padding: 8, marginBottom: 4 },
  linkTitle: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 3 },
  heading: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4, borderBottom: "0.75pt solid #cccccc", paddingBottom: 2 },
  // No lineHeight: with bold/italic runs nested inside a line, @react-pdf doubles it.
  para: { marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 3 },
  marker: { width: 12 },
  itemText: { flex: 1 },
  footer: {
    position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: "#888888",
    borderTop: "0.5pt solid #cccccc", paddingTop: 5, flexDirection: "row", justifyContent: "space-between",
  },
});

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <Text key={i} style={{ fontFamily: r.bold ? "Helvetica-Bold" : r.italic ? "Helvetica-Oblique" : "Helvetica" }}>{pdfSafe(r.text)}</Text>)}</>;
}

function List({ items, numbered, depth = 0 }: { items: Item[]; numbered: boolean; depth?: number }) {
  return (
    <View style={{ marginLeft: depth ? 12 : 0, marginBottom: depth ? 0 : 3 }}>
      {items.map((it, i) => (
        <View key={i}>
          <View style={styles.row}>
            <Text style={styles.marker}>{numbered ? `${i + 1}.` : depth ? "-" : "•"}</Text>
            <Text style={styles.itemText}><Runs runs={it.runs} /></Text>
          </View>
          {it.children.length > 0 && <List items={it.children} numbered={false} depth={depth + 1} />}
        </View>
      ))}
    </View>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.kind === "title") return <Text style={styles.title}>{pdfSafe(b.text)}</Text>;
  if (b.kind === "heading") return <Text style={styles.heading}>{pdfSafe(b.text)}</Text>;
  if (b.kind === "para") return <Text style={styles.para}><Runs runs={b.runs} /></Text>;
  return <List items={b.items} numbered={b.kind === "steps"} />;
}

export function HowtoDocument({ md, generatedAt }: { md: string; generatedAt: string }) {
  const blocks = parseHowto(md);
  const [title, ...rest] = blocks[0]?.kind === "title" ? blocks : [{ kind: "title", text: "Daily site log: how to" } as Block, ...blocks];
  return (
    <Document title="Daily site log - how to">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>LOBOS CONTRACTING</Text>
          <Text style={styles.docLabel}>Supervisor how-to</Text>
        </View>
        <BlockView b={title} />
        <View style={styles.linkBox}>
          <Text style={styles.linkTitle}>Opening your link</Text>
          <Text style={styles.para}>
            Use the link you already have - the Lobos Site page on your phone&apos;s home screen, or the link the office texted
            you. It&apos;s the same page as crew sign-in and requests. It&apos;s yours alone: don&apos;t share it or post it in a group chat.
            Lost it, or got a new phone? Ask the office for a new one - links are never printed.
          </Text>
        </View>
        {rest.map((b, i) => <BlockView key={i} b={b} />)}
        <View style={styles.footer} fixed>
          <Text>Lobos Contracting - daily site log pilot. Questions: Ilies.</Text>
          <Text>Printed {generatedAt}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderHowtoPdf(md: string): Promise<Buffer> {
  const generatedAt = new Date().toLocaleDateString("en-AU", { dateStyle: "medium", timeZone: "Australia/Sydney" });
  return renderToBuffer(<HowtoDocument md={md} generatedAt={generatedAt} />);
}
