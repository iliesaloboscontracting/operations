"use client";

import RegisterPage, { StatusPill } from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { effectiveStatus, STATUS_LABEL, whereToday, money } from "@/lib/resource";
import { AssetDatesCell, AssetDatesPanel, AssetDatesProvider } from "@/components/assets/AssetDates";

export default function PlantPage() {
  return (
    <AssetDatesProvider>
    <RegisterPage<ResourceDTO>
      config={{
        title: "Plant & Attachments",
        subtitle: "Owned plant and attachments. Hired gear lives in the Hire register.",
        addLabel: "Add plant",
        itemNoun: "plant item",
        // D4: insurance / service / inspection dates, read only (accounts edit them on Accounts -> Assets).
        detail: (r) => <AssetDatesPanel resourceId={r.id} />,
        api: "/api/resources",
        query: "type=EQUIPMENT,ATTACHMENT",
        sectionOf: (r) => (r.type === "ATTACHMENT" ? "Attachments" : "Plant"),
        sectionOrder: ["Plant", "Attachments"],
        searchText: (r) => `${r.name} ${r.detail} ${r.identifier}`,
        statusOf: effectiveStatus,
        statusOptions: [
          { value: "AVAILABLE", label: "Available" },
          { value: "ON_SITE", label: "On site" },
          { value: "DOWN", label: "Down" },
        ],
        newDefaults: { type: "EQUIPMENT", category: "Plant", role: "Plant", status: "AVAILABLE" },
        columns: [
          { label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
          { label: "Detail", render: (r) => r.detail },
          {
            label: "Daily rate",
            render: (r) => (r.dailyRateExGst ? <span className="text-gray-200">{money(r.dailyRateExGst)}<span className="text-gray-500"> ex GST</span></span> : null),
          },
          { label: "Service due", render: (r) => r.serviceDue },
          { label: "Insurance / service dates", render: (r) => <AssetDatesCell resourceId={r.id} /> },
          {
            label: "Status",
            render: (r) => {
              const s = effectiveStatus(r);
              return <StatusPill value={s} label={STATUS_LABEL[s]} />;
            },
          },
          { label: "Where today", render: (r) => whereToday(r) },
        ],
        fields: [
          { key: "name", label: "Name", required: true, full: true },
          {
            key: "type",
            label: "Kind",
            type: "select",
            options: [
              { value: "EQUIPMENT", label: "Plant" },
              { value: "ATTACHMENT", label: "Attachment" },
            ],
          },
          { key: "identifier", label: "Asset tag / serial" },
          { key: "detail", label: "Detail (e.g. suits 5.5t Excavator)", full: true },
          { key: "dailyRateExGst", label: "Daily rate ($ ex GST)", type: "number", placeholder: "e.g. 300" },
          { key: "serviceDue", label: "Service due" },
          { key: "status", label: "Status", type: "select", options: [{ value: "AVAILABLE", label: "Available (auto)" }, { value: "DOWN", label: "Down / needs repair" }] },
          { key: "notes", label: "Notes", type: "textarea" },
        ],
      }}
    />
    </AssetDatesProvider>
  );
}
