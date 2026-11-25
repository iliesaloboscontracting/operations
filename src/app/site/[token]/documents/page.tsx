"use client";

import { use } from "react";
import SiteBrand from "@/components/site/SiteBrand";
import SiteDocumentsScreen from "@/components/site/SiteDocuments";

// Site documents on a supervisor's (or hand-over) link (Ilies approved 25 Nov 2026) - opened from the "Site documents"
// tile. No login; the link is the key, and the API decides which links may use it.
export default function SiteDocumentsPage({ params: paramsP }: { params: Promise<{ token: string }> }) {
  const { token } = use(paramsP);
  const api = `/api/site/${token}`;
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-5">
      <div className="mb-5 flex items-center justify-between"><SiteBrand /></div>
      <SiteDocumentsScreen api={api} onHome={() => { window.location.href = `/site/${token}`; }} />
    </div>
  );
}
