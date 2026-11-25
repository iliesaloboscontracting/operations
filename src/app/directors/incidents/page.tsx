"use client";

import { IncidentList } from "@/components/incidents/Incidents";

// Incident reports on the Directors screen (Ilies approved 25 Nov 2026) - DIRECTOR logins and the owner only.
export default function DirectorsIncidentsPage() {
  return <IncidentList base="/directors/incidents" />;
}