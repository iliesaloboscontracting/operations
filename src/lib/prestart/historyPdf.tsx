import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Image, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { STATE_LABEL, pdfText, type Audience, type CheckRow, type HistoryWhat, type MachineHistory } from "./history";

// A machine's pre-start records / service history as a PDF (12 Nov 2026) - made on the server with @react-pdf/renderer,
// as the scope PDF is (lib/scopePdf.tsx). It only ever gets the history DTO (history.ts), which the route has already
// passed through linkSafe - no money can reach it. Standard Helvetica, so only plain characters.

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottom: "2pt solid #111111", paddingBottom: 8, marginBottom: 10 },
  logo: { height: 26, width: 108 },
  docLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  machine: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 4 },
  meta: { fontSize: 8.5, color: "#555555", marginTop: 2 },
  down: { marginTop: 8, padding: 6, backgroundColor: "#b00000", color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  section: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6, borderBottom: "1pt solid #cccccc", paddingBottom: 3 },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #dddddd", paddingVertical: 4 },
  head: { flexDirection: "row", borderBottom: "1pt solid #999999", paddingBottom: 3, fontFamily: "Helvetica-Bold", fontSize: 8 },
  sub: { fontSize: 8, color: "#444444", marginTop: 1 },
  bad: { color: "#b00000" },
  empty: { fontStyle: "italic", color: "#666666" },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, fontSize: 7.5, color: "#888888", borderTop: "0.5pt solid #cccccc", paddingTop: 5, flexDirection: "row", justifyContent: "space-between" },
});

let logo: Buffer | null | undefined;
function logoPng(): Buffer | null {
  if (logo !== undefined) return logo;
  try { logo = readFileSync(path.join(process.cwd(), "public", "logo.png")); } catch { logo = null; }
  return logo;
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Header({ h, title }: { h: MachineHistory; title: string }) {
  const png = logoPng();
  return (
    <>
      <View style={styles.header}>
        {png ? <Image style={styles.logo} src={{ data: png, format: "png" }} /> : <Text style={styles.docLabel}>LOBOS</Text>}
        <Text style={styles.docLabel}>{title}</Text>
      </View>
      <Text style={styles.machine}>{h.machine}</Text>
      <Text style={styles.meta}>Generated {h.generatedAt} (Sydney)</Text>
      {h.doNotUse && <Text style={styles.down}>DO NOT USE - this machine is marked Down / has a Do-not-use fault open.</Text>}
    </>
  );
}

function Footer({ title }: { title: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{title}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

const W = { when: "17%", kind: "13%", who: "19%", meter: "11%", result: "40%" };
function CheckLine({ c }: { c: CheckRow }) {
  return (
    <View style={styles.row} wrap={false}>
      <View style={{ width: W.when, paddingRight: 6 }}><Text>{day(c.date)}</Text><Text style={styles.sub}>{c.time}</Text></View>
      <Text style={{ width: W.kind, paddingRight: 6 }}>{c.kindLabel}</Text>
      <Text style={{ width: W.who, paddingRight: 6 }}>{c.operator}</Text>
      <View style={{ width: W.meter, paddingRight: 6 }}>
        <Text>{c.hourMeter ?? "-"}</Text>
        {c.hourMeterNote && <Text style={styles.sub}>{c.hourMeterNote}</Text>}
      </View>
      <View style={{ width: W.result }}>
        <Text style={c.allOk ? {} : styles.bad}>{c.allOk ? "All OK" : `Failed: ${c.failed.join(", ")}`}</Text>
        {c.faults.map((f, i) => (
          <Text key={i} style={styles.sub}>Fault: {[f.item, f.description].filter(Boolean).join(" - ")} ({f.priorityLabel}, now {f.statusLabel})</Text>
        ))}
        {c.stillThere > 0 && <Text style={styles.sub}>{c.stillThere} known fault{c.stillThere === 1 ? "" : "s"} confirmed still there</Text>}
        {c.walkaround && <Text style={styles.sub}>{c.walkaround}</Text>}
      </View>
    </View>
  );
}

function ChecksDoc({ h, capped }: { h: MachineHistory; capped: boolean }) {
  const title = "Lobos Contracting – pre-start records";
  return (
    <Document title={`${h.machine} - pre-start records`}>
      <Page size="A4" style={styles.page}>
        <Header h={h} title={title} />
        <Text style={styles.meta}>Pre-start and post-check records, last {h.days} days, newest first. {h.checks.length} check{h.checks.length === 1 ? "" : "s"}.</Text>
        {capped && <Text style={[styles.meta, { fontFamily: "Helvetica-Bold" }]}>Showing the latest {PUBLIC_PDF_CHECKS} checks – download the CSV for all</Text>}
        <Text style={styles.section}>Checks</Text>
        <View style={styles.head} fixed>
          <Text style={{ width: W.when, paddingRight: 6 }}>Date</Text><Text style={{ width: W.kind, paddingRight: 6 }}>Check</Text><Text style={{ width: W.who, paddingRight: 6 }}>Operator</Text>
          <Text style={{ width: W.meter, paddingRight: 6 }}>Hour meter</Text><Text style={{ width: W.result }}>Checklist and faults</Text>
        </View>
        {h.checks.length ? h.checks.map((c, i) => <CheckLine key={i} c={c} />) : <Text style={styles.empty}>No pre-start or post-check in the last {h.days} days.</Text>}
        {h.truncated && <Text style={styles.sub}>Only the newest checks are shown - the office has the rest.</Text>}
        <Text style={[styles.sub, { marginTop: 8 }]}>{h.photosNote}</Text>
        <Footer title={title} />
      </Page>
    </Document>
  );
}

function ServiceDoc({ h }: { h: MachineHistory }) {
  const title = "Lobos Contracting – service history";
  const s = h.service;
  return (
    <Document title={`${h.machine} - service history`}>
      <Page size="A4" style={styles.page}>
        <Header h={h} title={title} />
        <Text style={styles.section}>Dates</Text>
        {s.dates.map((d, i) => (
          <View key={i} style={styles.row}>
            <Text style={{ width: "40%" }}>{d.label}</Text>
            <Text style={{ width: "30%" }}>{d.expiryDate ? day(d.expiryDate) : "Not recorded"}</Text>
            <Text style={[{ width: "30%" }, d.state === "EXPIRED" ? styles.bad : {}]}>{STATE_LABEL[d.state] ?? d.state}</Text>
          </View>
        ))}
        {s.registerNote && <Text style={styles.sub}>Service due (Plant register): {s.registerNote}</Text>}
        <Text style={styles.section}>Services</Text>
        <View style={styles.head}>
          <Text style={{ width: "18%" }}>Date</Text><Text style={{ width: "50%" }}>Work done</Text><Text style={{ width: "20%" }}>Provider</Text><Text style={{ width: "12%" }}>Odometer / hours</Text>
        </View>
        {s.records.length ? s.records.map((r, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={{ width: "18%" }}>{day(r.date)}</Text>
            <Text style={{ width: "50%", paddingRight: 8 }}>{r.work ?? "-"}</Text>
            <Text style={{ width: "20%", paddingRight: 6 }}>{r.provider ?? "-"}</Text>
            <Text style={{ width: "12%" }}>{r.reading ?? "-"}</Text>
          </View>
        )) : <Text style={styles.empty}>No services recorded.</Text>}
        <Text style={styles.section}>Open faults</Text>
        {s.openFaults.length ? s.openFaults.map((f, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={{ width: "18%" }}>{day(f.reportedOn)}</Text>
            <Text style={{ width: "52%", paddingRight: 8 }}>{[f.item, f.description].filter(Boolean).join(" - ")}</Text>
            <Text style={[{ width: "15%" }, f.priority === "DO_NOT_USE" || f.priority === "URGENT" ? styles.bad : {}]}>{f.priorityLabel}</Text>
            <Text style={{ width: "15%" }}>{f.statusLabel}</Text>
          </View>
        )) : <Text style={styles.empty}>No open faults.</Text>}
        <Footer title={title} />
      </Page>
    </Document>
  );
}

const safe = <T,>(x: T): T =>
  (typeof x === "string" ? pdfText(x) : Array.isArray(x) ? x.map(safe) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, safe(v)])) : x) as T;

// PS-066 (Ilies approved 12 Nov 2026): a 400-check PDF blocked the server's event loop for ~4 s (measured on a copy,
// 12 Nov 2026), so the QR's (public) PDF carries the latest PUBLIC_PDF_CHECKS checks and says so; the CSV and the
// office PDF keep up to MAX_CHECKS.
export const PUBLIC_PDF_CHECKS = 150;
export async function renderHistoryPdf(h: MachineHistory, what: HistoryWhat, audience: Audience = "public"): Promise<Buffer> {
  const capped = what === "checks" && audience === "public" && h.checks.length > PUBLIC_PDF_CHECKS;
  if (capped) h = { ...h, checks: h.checks.slice(0, PUBLIC_PDF_CHECKS) };
  const s = safe(h);
  return renderToBuffer(what === "service" ? <ServiceDoc h={s} /> : <ChecksDoc h={s} capped={capped} />);
}
