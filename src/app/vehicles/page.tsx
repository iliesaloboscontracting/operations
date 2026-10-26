"use client";

import RegisterPage, { StatusPill } from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { effectiveStatus, STATUS_LABEL, whereToday, money } from "@/lib/resource";
import ServiceHistory from "@/components/ServiceHistory";
import { TruckIndicatorsPanel } from "@/components/receipts/Indicators";

const TYPES = ["Hook", "Tipper", "Ute", "Other"];

export default function VehiclesPage() {
  return (
    <RegisterPage<ResourceDTO>
      config={{
        title: "Vehicles",
        subtitle: "The fleet by type and load size. Allocate them to sites in Allocations. Open a vehicle to see its service history.",
        addLabel: "Add vehicle",
        itemNoun: "vehicle",
        // Odometer and fuel from Receipts (R4) - Lobos trucks only, Managers and up (it has fuel $).
        detail: (r) => <><ServiceHistory resourceId={r.id} />{r.ownership === "OWNED" && r.category !== "Other" && <TruckIndicatorsPanel vehicleId={r.id} />}</>,
        api: "/api/resources",
        query: "type=VEHICLE",
        sectionOf: (r) => (r.category ?? "Other").toUpperCase(),
        sectionOrder: TYPES.map((t) => t.toUpperCase()),
        searchText: (r) => `${r.name} ${r.identifier} ${r.notes}`,
        statusOf: effectiveStatus,
        statusOptions: [
          { value: "AVAILABLE", label: "Available" },
          { value: "ON_SITE", label: "On site" },
          { value: "DOWN", label: "Down" },
        ],
        newDefaults: { type: "VEHICLE", category: "Tipper", role: "Vehicle", ownership: "OWNED", status: "AVAILABLE" },
        columns: [
          { label: "Vehicle", render: (r) => <span className="font-medium">{r.name}</span> },
          { label: "Rego", render: (r) => r.identifier },
          { label: "Load size", render: (r) => r.loadSize },
          {
            label: "Daily rate",
            render: (r) => (r.dailyRateExGst ? <span className="text-gray-200">{money(r.dailyRateExGst)}<span className="text-gray-500"> ex GST</span></span> : null),
          },
          { label: "Owned / hired", render: (r) => <StatusPill value="" label={r.ownership} /> },
          {
            label: "Status",
            render: (r) => {
              const s = effectiveStatus(r);
              return <StatusPill value={s} label={STATUS_LABEL[s]} />;
            },
          },
          { label: "Where today", render: (r) => whereToday(r) },
          { label: "Notes", render: (r) => r.notes },
        ],
        fields: [
          { key: "name", label: "Name", required: true, full: true },
          { key: "category", label: "Type", type: "select", options: TYPES },
          { key: "identifier", label: "Rego" },
          { key: "loadSize", label: "Load size" },
          { key: "dailyRateExGst", label: "Daily rate ($ ex GST)", type: "number", placeholder: "e.g. 300" },
          { key: "ownership", label: "Owned / hired", type: "select", options: ["OWNED", "HIRED"] },
          { key: "status", label: "Status", type: "select", options: [{ value: "AVAILABLE", label: "Available (auto)" }, { value: "DOWN", label: "Down / off road" }] },
          { key: "serviceDue", label: "Service due" },
          { key: "notes", label: "Notes (rego expiry, value...)", type: "textarea" },
        ],
      }}
    />
  );
}
