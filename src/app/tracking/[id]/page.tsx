"use client";

import { use } from "react";
import JobView from "@/components/tracking/JobView";

// Project Tracking - one job. The page itself is shared with the Directors
// screen - see components/tracking/JobView.tsx.
export default function TrackingJobPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = use(paramsP);
  return <JobView id={id} mode="ops" />;
}
