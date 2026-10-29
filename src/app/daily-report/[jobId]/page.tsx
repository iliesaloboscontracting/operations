"use client";

import { use } from "react";
import SiteReport from "@/components/dailyReport/SiteReport";

// The written daily site report for one job on one day (29 Oct 2026) - Manager+ (the API checks). Linked from Day
// Review's site-log panel and the Tracking job page. The page is shared with the Directors screen.
export default function SiteReportPage({ params: paramsP }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(paramsP);
  return <SiteReport jobId={jobId} mode="ops" />;
}
