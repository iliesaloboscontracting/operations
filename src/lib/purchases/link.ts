// The OFFICE-link side of purchase requests (2 Nov 2026): the one link a dollar figure may reach, and only on its
// purchase screens (quotes.ts linkMayCarryMoney). Every route under /api/site/<token>/purchases resolves its link here;
// any other link kind (SUPERVISOR, HANDOVER, DRIVER, POSTER) or a shared OFFICE link with no person gets null -> 404.
import { resolveLink } from "../siteLinks";
import { linkMayCarryMoney } from "./quotes";

export async function officePurchasesLink(token: string) {
  const link = await resolveLink(token);
  return link && link.person.id && linkMayCarryMoney(link.kind, "PURCHASES") ? link : null;
}
