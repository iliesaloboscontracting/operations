"use client";

import { use } from "react";
import JobView from "@/components/tracking/JobView";

// One job's costs on the Directors screen (25 Oct 2026) - read-only, no links
// into Operations (directors-only logins can't open Operations pages).
export default function DirectorJobPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = use(paramsP);
  return <JobView id={id} mode="director" />;
}
