// Who can have a supervisor link (crew sign-in + their toolbox): site
// supervisors and team leaders (Ilies, 21 Oct 2026). One rule, used by the
// From site dropdown and checked again by /api/site-links.
//   - category "Site Manager", or
//   - a role of Supervisor / Lead / Leading hand / Foreman (any category -
//     e.g. a Truck Driver who supervises, a Labourer who leads), or
//   - already in charge of a toolbox (checked by the caller).
export function isLead(p: { category?: string | null; role?: string | null }) {
  return p.category === "Site Manager" || /supervis|\blead|foreman/i.test(p.role ?? "");
}
