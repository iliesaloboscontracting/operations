// Hire kinds (21 Oct 2026, Ilies): supplier hire is equipment only - no
// operator - from a hire company; subcontractors supply people or plant WITH
// an operator / driver (labour hire, wet hire, subcontract trucks). Kept as
// two clearly separate groups on the Hire page. Stored in Resource.category.

export const SUPPLIER_HIRE_KINDS = ["PLANT", "EQUIPMENT", "TOOLS"] as const;
export const SUBCONTRACT_KINDS = ["LABOUR", "WET_HIRE", "VEHICLE"] as const;

export const HIRE_KIND_LABEL: Record<string, string> = {
  PLANT: "Plant",
  EQUIPMENT: "Equipment",
  TOOLS: "Tools",
  LABOUR: "Labour hire",
  WET_HIRE: "Plant + operator",
  VEHICLE: "Trucks",
};

export function isSubcontract(category: string | null | undefined): boolean {
  return (SUBCONTRACT_KINDS as readonly string[]).includes(category ?? "");
}
