"use client";

import { use } from "react";
import { IncidentDetail } from "@/components/incidents/Incidents";

// One incident report on the Directors screen - DIRECTOR logins and the owner only. Printable; follow-up notes beside it.
export default function DirectorsIncidentPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = use(paramsP);
  return <IncidentDetail id={id} back="/directors/incidents" />;
}