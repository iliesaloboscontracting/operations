// Project pickers (Ilies, 2 Nov 2026: "these lists need to include the jobs that are inactive and completed. if the
// completed one is selected then it needs the question to be asked if the job is active or completed").
// Plain rules only - no server or React imports - so the pickers (components/ProjectSelect.tsx) and `npm test`
// (projectPicker.test.ts) read the same lists.
//
// Every office picker that attaches a record to a project lists Active, then Inactive, then Completed projects,
// each group by name, with the status in the label ("Bronte (completed)"). Choosing an Inactive one just works.
// Choosing a Completed one asks "is this job active again, or still completed?" - "Active again" sets the project
// back to ACTIVE through the ordinary project PATCH (Manager+, enforced there), "Still completed" keeps the choice
// and leaves the project as it is, "Cancel" puts the picker back. Site-link pickers are not these - they stay
// active-only.

export type ProjectStatus = "ACTIVE" | "INACTIVE" | "COMPLETED";
export type PickerProject = { id: string; name: string; status?: string | null };

export const STATUS_ORDER: readonly ProjectStatus[] = ["ACTIVE", "INACTIVE", "COMPLETED"];
export const GROUP_LABEL: Record<ProjectStatus, string> = { ACTIVE: "Active", INACTIVE: "Inactive", COMPLETED: "Completed" };

// A missing status is treated as Active (the purchases picker on a link sends names only, all active); anything
// else that isn't ACTIVE or COMPLETED reads as Inactive - never hidden.
export function pickerStatus(p: PickerProject): ProjectStatus {
  const s = p.status ?? "ACTIVE";
  return s === "ACTIVE" || s === "COMPLETED" ? s : "INACTIVE";
}

// "Bronte (completed)", "Myers (inactive)", "Coogee" - `base` lets a picker show more than the name (job number,
// client) while the status words stay the same everywhere.
export function projectOptionLabel(p: PickerProject, base: string = p.name): string {
  const s = pickerStatus(p);
  return s === "ACTIVE" ? base : `${base} (${s.toLowerCase()})`;
}

export type ProjectGroup<T extends PickerProject> = { status: ProjectStatus; label: string; projects: T[] };

// Active, then Inactive, then Completed; by name inside each (case and accents ignored); empty groups left out.
export function groupProjects<T extends PickerProject>(projects: readonly T[]): ProjectGroup<T>[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" }) || a.id.localeCompare(b.id);
  return STATUS_ORDER.map((status) => ({
    status,
    label: GROUP_LABEL[status],
    projects: projects.filter((p) => pickerStatus(p) === status).sort(byName),
  })).filter((g) => g.projects.length > 0);
}

// Who may set a project back to Active: the same people the project PATCH lets in (guard("MANAGER") - Managers
// and Admins). Never the coordinator, accounts, a director login, a Viewer or a timesheets login.
export const canReactivateProject = (role: string | null | undefined) => role === "ADMIN" || role === "MANAGER";

export type CompletedChoice = "REACTIVATE" | "KEEP" | "CANCEL";
export const CHOICE_LABEL: Record<CompletedChoice, string> = { REACTIVATE: "Active again", KEEP: "Still completed", CANCEL: "Cancel" };

export type PickQuestion = { question: string; choices: CompletedChoice[] };

// What happens when someone picks `p`: null = take it straight away (Active, Inactive, nothing chosen, or the value
// it already had); otherwise the question to ask and the buttons to offer.
export function completedPickQuestion(p: PickerProject | null | undefined, canReactivate: boolean, previousId?: string | null): PickQuestion | null {
  if (!p || p.id === previousId || pickerStatus(p) !== "COMPLETED") return null;
  return {
    question: `${p.name} is marked Completed. Is this job active again, or still completed?`,
    choices: canReactivate ? ["REACTIVATE", "KEEP", "CANCEL"] : ["KEEP", "CANCEL"],
  };
}

// The outcome of a choice: which value the picker ends on, and whether the project PATCH { status: "ACTIVE" } is
// sent. A REACTIVATE from someone who can't is treated as Cancel (the button isn't offered; the server refuses too).
export function resolveCompletedChoice(choice: CompletedChoice, pickedId: string, previousId: string, canReactivate: boolean):
  { value: string; reactivate: boolean } {
  if (choice === "REACTIVATE" && canReactivate) return { value: pickedId, reactivate: true };
  if (choice === "KEEP") return { value: pickedId, reactivate: false };
  return { value: previousId, reactivate: false };
}
