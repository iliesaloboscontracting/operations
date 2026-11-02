// Lobos staff signing in as "hire" (fix 4, Ilies 2 Nov 2026 - "Ratu / Lobos", "Muhammet / Lobos", "Abdelhak /
// Lobos" in the week of 26 Oct). A hire sign-in has no register person, so it never reaches the staff timesheet.
// These plain rules say when one looks like staff: the company is Lobos (any case or spacing), or the name typed is
// an active Labour-register person's name (in full, or their first name when that's all that was typed).

export type StaffMatch = { id: string; name: string };
export type StaffSuggestion = StaffMatch & { exact: boolean }; // exact = the full name matched (only then pre-selected)

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

export const looksLikeLobos = (company: string | null | undefined) => !!company && words(company).join("").includes("lobos");

// The staff a hire sign-in may be: name matches first; [] when only the company gave it away; null = not staff-like.
// TF-009: a first name alone only suggests someone when the company is Lobos (a "Sam" from Labourforce is a real hire
// worker), and only a full-name match is marked exact.
export function staffSuggestions(hire: { name: string; company: string | null }, staff: StaffMatch[]): StaffSuggestion[] | null {
  const typed = words(hire.name);
  const lobos = looksLikeLobos(hire.company);
  const out: StaffSuggestion[] = [];
  if (typed.length) for (const s of staff) {
    const w = words(s.name);
    if (w.join(" ") === typed.join(" ")) out.push({ ...s, exact: true });
    else if (lobos && typed.length === 1 && w[0] === typed[0]) out.push({ ...s, exact: false });
  }
  if (out.length) return out.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 5);
  return lobos ? [] : null;
}
