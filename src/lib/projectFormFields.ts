import type { FieldDef } from "@/components/FormModal";

// The basic project form (name, client, address, hours, notes...) - shared by
// the Projects page's "Add project" and the project page's "Edit details", so
// there's one form, not two. The Project File's own fields (Site, Contacts,
// Scope exclusions...) are edited on the project page itself.
export const PROJECT_FORM_FIELDS: FieldDef[] = [
  { key: "name", label: "Job / site name", required: true, full: true },
  { key: "client", label: "Client", placeholder: "e.g. CD Constructions" },
  { key: "jobNo", label: "Job number" },
  { key: "address", label: "Address", full: true },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "ACTIVE", label: "Active" },
      { value: "INACTIVE", label: "Inactive" },
      { value: "COMPLETED", label: "Completed (moves to the Completed page)" },
    ],
  },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "dayStart", label: "Day start", placeholder: "7am" },
  { key: "dayEnd", label: "Day end", placeholder: "3:30pm" },
  { key: "nightStart", label: "Night start", placeholder: "10pm" },
  { key: "nightEnd", label: "Night end", placeholder: "6am" },
  { key: "unpaidBreakMinutes", label: "Unpaid meal break (minutes)", type: "number", placeholder: "30" },
  { key: "notes", label: "Notes (internal)", type: "textarea" },
];
