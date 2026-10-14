// The one money-guard text check, shared by everything that can go out to
// crew or clients: the day sheet (daySheet.ts / DaySheetModal), the scope PDF
// (api/projects/[id]/scope-pdf) and the Project File's Site, Scope and
// Contacts fields when they're saved (lib/projectFile.ts). Previously copied
// into both daySheet.ts and scopePdf.tsx.
//
// True when the text looks clean of any dollar figure - money() always
// renders as "$" + digits (en-AU currency formatting), so a bare "$\d" is a
// reliable enough signal without false-positiving on job numbers, phone
// numbers or times.
export function assertNoMoney(text: string): boolean {
  return !/\$\s?\d/.test(text);
}
