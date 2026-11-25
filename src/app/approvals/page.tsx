// /approvals (25 Nov 2026, Ilies: "yes rename to approvals"): the address that matches the page's name. The page
// itself stays at /changes (phone alerts, links and the release checks use it) - this only sends people there,
// so who may see it is decided by /changes and its API exactly as before.
import { redirect } from "next/navigation";

export default function ApprovalsPage(): never {
  redirect("/changes");
}
