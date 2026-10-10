import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

// Generates the per-project "Scope of Works" PDF - one per site, covering the
// durable facts (client, address, shift windows, the scope text itself), never
// the daily crew/plant for a specific date (that still only lives in the day
// sheet text) and never a dollar figure (this is designed to travel with the
// crew-facing allocation email - see daySheet.ts's money-guard for why).

export interface ScopePdfProject {
  name: string;
  client: string | null;
  jobNo: string | null;
  address: string | null;
  status: string;
  dayStart: string | null;
  dayEnd: string | null;
  nightStart: string | null;
  nightEnd: string | null;
  scopeOfWorks: string | null;
}

// Mirrors daySheet.ts's assertNoMoney - same signal ("$" immediately before a
// digit), applied here to the one field an editor could put a price into
// before it reaches this document.
export function assertNoMoney(text: string): boolean {
  return !/\$\s?\d/.test(text);
}

function paragraphs(text: string) {
  return text
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { borderBottom: "2pt solid #111111", paddingBottom: 10, marginBottom: 14 },
  company: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  docLabel: { fontSize: 9, color: "#555555", marginTop: 2, textTransform: "uppercase", letterSpacing: 1 },
  jobTitle: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: 12 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
  metaBlock: { width: "50%", marginBottom: 8 },
  metaLabel: { fontSize: 8, color: "#666666", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 10.5, marginTop: 2 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 18,
    marginBottom: 8,
    borderBottom: "1pt solid #cccccc",
    paddingBottom: 5,
  },
  paragraph: { marginBottom: 7, lineHeight: 1.45 },
  noScope: { fontStyle: "italic", color: "#666666", lineHeight: 1.45 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: "#888888",
    borderTop: "0.5pt solid #cccccc",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.metaBlock}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function shiftWindow(startLabel: string, start: string | null, end: string | null) {
  if (!start) return null;
  return `${startLabel}: ${start}${end ? ` – ${end}` : ""}`;
}

export function ScopeDocument({ project, generatedAt }: { project: ScopePdfProject; generatedAt: string }) {
  const day = shiftWindow("Day shift", project.dayStart, project.dayEnd);
  const night = shiftWindow("Night shift", project.nightStart, project.nightEnd);
  const scopeParas = project.scopeOfWorks ? paragraphs(project.scopeOfWorks) : [];

  return (
    <Document title={`${project.name} - Scope of Works`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>LOBOS CONTRACTING</Text>
          <Text style={styles.docLabel}>Scope of Works</Text>
        </View>

        <Text style={styles.jobTitle}>{project.name}</Text>

        <View style={styles.metaGrid}>
          <Meta label="Client" value={project.client} />
          <Meta label="Job number" value={project.jobNo} />
          <Meta label="Address" value={project.address} />
          <Meta label="Status" value={project.status} />
          <Meta label="Shift" value={[day, night].filter(Boolean).join("   ") || null} />
        </View>

        <Text style={styles.sectionTitle}>Scope of Works</Text>
        {scopeParas.length ? (
          scopeParas.map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p}
            </Text>
          ))
        ) : (
          <Text style={styles.noScope}>
            No fixed scope-of-works document is on file for this site - work proceeds as instructed by the
            builder/client supervisor on site.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text>Lobos Contracting Pty Ltd — Demolition Licence AD213800 — Asbestos Removal Licence AD214246</Text>
          <Text>Generated {generatedAt}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderScopePdf(project: ScopePdfProject): Promise<Buffer> {
  const generatedAt = new Date().toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
  });
  return renderToBuffer(<ScopeDocument project={project} generatedAt={generatedAt} />);
}
