// Release check: judging `npm audit --json` against the owner's recorded exceptions (expected.mjs AUDIT_EXCEPTIONS,
// record in docs/security/EXCEPTIONS.md). Pure function - unit-tested in audit.test.mjs.
//
// Rule: every advisory of moderate severity or above FAILS unless an ACTIVE exception accepts it exactly - same
// package, same GHSA ids (or the same "via" packages for a parent that only inherits one), no higher severity, and
// no new package affected. A new GHSA, a worse severity, the package turning up somewhere new, or a past expiry date
// all FAIL. Low / info advisories are listed but don't fail.
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const ghsaOf = (via) => (via.url ?? "").split("/").pop() || via.source?.toString() || via.title || "?";

export function exceptionActive(ex, { today, nextVersion }) {
  // "Until the expiry date": from that Sydney date on, the exception no longer applies.
  if (today >= ex.expires) return { active: false, why: `${ex.id} expired on ${ex.expires}` };
  const major = Number(String(nextVersion ?? "").split(".")[0]);
  if (ex.endsAtNextMajor && Number.isFinite(major) && major >= ex.endsAtNextMajor) return { active: false, why: `${ex.id} ended at the Next.js ${ex.endsAtNextMajor} upgrade (next ${nextVersion})` };
  return { active: true };
}

// One vulnerability entry vs one accepted entry -> null (accepted) or why not.
function mismatch(v, a) {
  if (RANK[v.severity] > RANK[a.maxSeverity]) return `severity ${v.severity} is worse than the accepted ${a.maxSeverity}`;
  for (const via of v.via ?? []) {
    if (typeof via === "string") { if (!(a.via ?? []).includes(via)) return `newly affected through ${via}`; continue; }
    const id = ghsaOf(via);
    const okSev = a.ghsa?.[id];
    if (!okSev) return `new advisory ${id}`;
    if (RANK[via.severity] > RANK[okSev]) return `${id} is now ${via.severity} (accepted ${okSev})`;
  }
  if (a.effectsWithin) { const extra = (v.effects ?? []).filter((e) => !a.effectsWithin.includes(e)); if (extra.length) return `now also affects ${extra.join(", ")}`; }
  if (a.nodes) { const extra = (v.nodes ?? []).filter((n) => !a.nodes.some((re) => re.test(n))); if (extra.length) return `now also installed at ${extra.join(", ")}`; }
  return null;
}

export function judgeAudit(json, exceptions, ctx) {
  const vulns = Object.values(json?.vulnerabilities ?? {});
  const meta = json?.metadata?.vulnerabilities;
  if (!meta) return { status: "BLOCKED", reason: "couldn't read the audit (registry unreachable?)", accepted: [], failing: [], minor: [] };
  const states = exceptions.map((ex) => ({ ex, ...exceptionActive(ex, ctx) }));
  const accepted = [], failing = [], minor = [];
  for (const v of vulns) {
    const label = `${v.name}(${v.severity})`;
    if (RANK[v.severity] < RANK.moderate) { minor.push(label); continue; }
    let verdict = null;
    for (const s of states) {
      const a = s.ex.entries.find((e) => e.pkg === v.name);
      if (!a) continue;
      if (!s.active) { verdict = { fail: `${label} - ${s.why}` }; break; }
      const why = mismatch(v, a);
      verdict = why ? { fail: `${label} - not covered by ${s.ex.id}: ${why}` } : { ok: `${label} accepted: ${s.ex.id}` };
      break;
    }
    if (!verdict) verdict = { fail: `${label} - no exception (${(v.via ?? []).map((x) => (typeof x === "string" ? "via " + x : ghsaOf(x))).join(", ")})` };
    (verdict.ok ? accepted : failing).push(verdict.ok ?? verdict.fail);
  }
  const counts = `critical ${meta.critical}, high ${meta.high}, moderate ${meta.moderate}, low ${meta.low}`;
  const reason = [counts, failing.length && `FAILING: ${failing.join("; ")}`, accepted.length && `accepted: ${accepted.join("; ")}`, minor.length && `low/info (not gating): ${minor.join(", ")}`].filter(Boolean).join(" | ");
  return { status: failing.length ? "FAIL" : "PASS", reason, accepted, failing, minor };
}
