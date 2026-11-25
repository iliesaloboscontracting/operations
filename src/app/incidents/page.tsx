"use client";

import { IncidentList } from "@/components/incidents/Incidents";

// Incident reports (Ilies approved 25 Nov 2026) - the owner's view in Operations. The directors read the same list on
// /directors/incidents. Nobody else (the API refuses them).
export default function IncidentsPage() {
  return <IncidentList base="/incidents" />;
}