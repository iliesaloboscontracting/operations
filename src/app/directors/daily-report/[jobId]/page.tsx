"use client";

import { use } from "react";
import SiteReport from "@/components/dailyReport/SiteReport";

// The directors' copy of the written daily site report (29 Oct 2026) - guardDirector on its API; read-only.
export default function DirectorSiteReportPage({ params: paramsP }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(paramsP);
  return <SiteReport jobId={jobId} mode="director" />;
}
