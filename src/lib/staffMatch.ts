// Lobos staff signing in as "hire" (fix 4, Ilies 2 Nov 2026 - "Ratu / Lobos", "Muhammet / Lobos", "Abdelhak /
// Lobos" in the week of 26 Oct). A hire sign-in has no register person, so it never reaches the staff timesheet.
// These plain rules say when one looks like staff: the company is Lobos (any case or spacing), or the name typed is
// an active Labour-register person's name (in full, or their first name when that's all that was typed).

export type StaffMatch = { id: string; name: string };

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

export const looksLikeLobos = (company: string | null | undefined) => !!company && words(company).join("").includes("lobos");

// The staff a hire sign-in may be: name matches first; [] when only the company gave it away; null = not staff-like.
export function staffSuggestions(hire: { name: string; company: string | null }, staff: StaffMatch[]): StaffMatch[] | null {
  const typed = words(hire.name);
  const matches = typed.length === 0 ? [] : staff.filter((s) => {
    const w = words(s.name);
    return w.join(" ") === typed.join(" ") || (typed.length === 1 && w[0] === typed[0]);
  });
  if (matches.length) return matches.slice(0, 5);
  return looksLikeLobos(hire.company) ? [] : null;
}
