"use client";

import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { Download, Printer } from "lucide-react";

// The supervisors' daily log how-to (Task L, 25 Oct 2026): a one-page A4 PDF
// to print or send to the pilot supervisors. Manager+ (the PDF route checks
// too). It carries no link - each supervisor uses the link they already have.
export default function SiteLogHowtoPage() {
  const { canEdit, loading } = useAuth();
  if (loading) return <PageShell title="Daily log how-to"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit) return <PageShell title="Daily log how-to"><p className="text-sm text-gray-500">Managers and Admins only.</p></PageShell>;
  const btn = "inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-panel2";
  return (
    <PageShell
      title="Daily log how-to"
      subtitle="One page for the pilot supervisors - print it or send the PDF. No link is printed on it: they use the link they already have."
      actions={
        <div className="flex gap-2">
          <a href="/api/site-log-howto" target="_blank" rel="noreferrer" className={btn}><Printer size={13} /> Open to print</a>
          <a href="/api/site-log-howto?download=1" className={btn}><Download size={13} /> Download PDF</a>
        </div>
      }
    >
      <iframe src="/api/site-log-howto" title="Daily log how-to" className="h-[calc(100vh-11rem)] w-full rounded-xl border border-edge bg-white" />
    </PageShell>
  );
}
