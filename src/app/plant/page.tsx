"use client";

import RegisterPage, { StatusPill } from "@/components/RegisterPage";
import { ResourceDTO } from "@/lib/types";
import { effectiveStatus, STATUS_LABEL, whereToday, money } from "@/lib/resource";
import { AssetDatesCell, AssetDatesPanel, AssetDatesProvider } from "@/components/assets/AssetDates";
import { FaultFlagBadge, FaultFlagsProvider } from "@/components/faults/FaultFlags";
import PlantQrPanel from "@/components/plant/PlantQrPanel";
import { useAuth } from "@/components/AuthProvider";

export default function PlantPage() {
  const { canEdit } = useAuth();
  return (
    <AssetDatesProvider>
    {/* Open faults from the pre-start checks (stage 2, 10 Nov 2026): an icon by the name, information only. */}
    <FaultFlagsProvider enabled={canEdit}>
    <RegisterPage<ResourceDTO>
      config={{
        title: "Plant & Attachments",
        subtitle: "Owned plant and attachments. Hired gear lives in the Hire register.",
        addLabel: "Add plant",
        itemNoun: "plant item",
        // D4: insurance / service / inspection dates, read only (accounts edit them on Accounts -> Assets).
        // Stage 2 (10 Nov 2026): owned plant's pre-start QR sticker - print / reprint / off (Managers and Admins).
        detail: (r) => <><AssetDatesPanel resourceId={r.id} /><PlantQrPanel machine={{ id: r.id, name: r.name, type: r.type, ownership: r.ownership ?? "OWNED" }} /></>,
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
          { label: "Name", render: (r) => <span className="inline-flex items-center gap-1.5 font-medium">{r.name}<FaultFlagBadge resourceId={r.id} /></span> },
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
    </FaultFlagsProvider>
    </AssetDatesProvider>
  );
}
