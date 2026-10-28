// The site a sales invoice is assumed to be for, from its reference (Ilies, 28 Oct 2026: type "Randwick" and "all assumed
// Randwick invoices are grouped"). References are "<site> - <claim / month>" ("Randwick - PC03", "Woollahra - Aug 25"), but
// sometimes the code comes first ("PC07 - Randwick"). So: split on " - " and take the first part that isn't a code. An
// assumption for grouping only - nothing is tied to a job until a person picks it.
export const NO_SITE = "No site in the reference";

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const CODE = [
  /^(pc|po|v|s|inv|hst|cd)[\s-]*\d*$/i, // PC03, PO0465, V04, S0003331, INV-0018, HST-6552, CD
  new RegExp(`^${MONTH}[\\s-]*\\d{0,4}$`, "i"), // Aug 25, Jul-26, Sep26, Oct
  /^\d+%$/, // 50%
  /^w\/?e\b/i, // WE 02/08
];
const isCode = (part: string) => CODE.some((re) => re.test(part));

export function siteOf(reference: string | null | undefined): string {
  const parts = (reference ?? "").split(/\s+-\s+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  return parts.find((p) => !isCode(p)) ?? NO_SITE;
}
