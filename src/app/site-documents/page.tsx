import { redirect } from "next/navigation";
import { siteDocumentsHref } from "@/lib/documentsTabs";

// The old address of the office's Site documents (25 Nov 2026). Since 26 Nov 2026 they live in the Documents page
// (Ilies: "the documents should have never have been put here. there is already a documents tab which is where the new
// feature should have been put" - "Yes, one place: Documents"), so /site-documents (and ?projectId=) goes to
// /documents?tab=site with the project kept. The sub-pages (/site-documents/topic, /records/<id>, /swms/<id>) stay where
// they are - alerts and links point at them. Who may see it is still decided by the Documents page and the APIs.
export default async function SiteDocumentsMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pid = typeof sp.projectId === "string" ? sp.projectId : null;
  redirect(siteDocumentsHref(pid));
}
