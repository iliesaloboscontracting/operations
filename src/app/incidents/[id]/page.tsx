"use client";

import { use } from "react";
import { IncidentDetail } from "@/components/incidents/Incidents";

// One incident report (the owner; the phone alert opens this). Printable; follow-up notes beside it.
export default function IncidentPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = use(paramsP);
  return <IncidentDetail id={id} back="/incidents" />;
}