# LCI phase 6 - folders for document search: draft for Ilies to tick (27 Oct 2026)

This was drafted by browsing SharePoint **read-only** on 27 Oct: the Management site, Shared Documents → "Lobos Demolition". Nothing was written, moved or renamed.

**How to use it:**
- Tick ✅ or cross ❌ each line, and change a level if you want. Only ticked folders are read; every folder is off until then (`approved: false` in `src/lib/docsearch/folders.ts`).
- `*` means "every project" or "every tender": each live project uses the same numbered template (`22_001_01` … `22_001_17`).

**Levels:**
- **MANAGER:** Manager and Admin logins.
- **COMMERCIAL:** Admin logins, and Managers with director access.

**DIRECTOR and ACCOUNTS logins** don't get document search for now. They're off the Operations screens.

## Proposed: read these

| ✓? | Folder (below "Lobos Demolition") | Level | What's in it |
|---|---|---|---|
| ☐ | `01_Projects - Live/*/22_001_09_HSE & Site Management/04_SWMS` | MANAGER | each job's SWMS |
| ☐ | `01_Projects - Live/*/22_001_09_HSE & Site Management/02_Site Induction` | MANAGER | inductions |
| ☐ | `01_Projects - Live/*/22_001_09_HSE & Site Management/03_Tool box Talks` | MANAGER | toolbox talks |
| ☐ | `01_Projects - Live/*/22_001_09_HSE & Site Management/05_Hot Work Permit` | MANAGER | hot work permits |
| ☐ | `03_General/Demolition Work Plans` | MANAGER | company work plans |
| ☐ | `03_General/Methodologies` | MANAGER | methodologies |
| ☐ | `03_General/Checklists` | MANAGER | checklists |
| ☐ | `03_General/Waste Disposal Documents` | MANAGER | waste / tip documents |
| ☐ | `00_Templates` | MANAGER | blank templates (see the note below: please confirm) |
| ☐ | `01_Projects - Live/*/22_001_04_Drawing Records` | MANAGER | drawings (most are drawings-only PDFs; their title blocks are searchable) |
| ☐ | `01_Projects - Live/*/22_001_07_Programme` | MANAGER | programmes |
| ☐ | `01_Projects - Live/*/22_001_06_ Meeting Minutes` | MANAGER | site meeting minutes |
| ☐ | `01_Projects - Live/*/22_001_13_Quality Management` | MANAGER | ITPs, quality records |
| ☐ | `01_Projects - Live/*/22_001_08_Registers (Tools & Equipment)` | MANAGER | registers |
| ☐ | `01_Projects - Live/*/ESTIMATE STAGE` | COMMERCIAL | the scope as tendered, with the estimate and quote (DS-019: moved up from MANAGER, because it holds the tender price build-up) |
| ☐ | `01_Projects - Live/*/22_001_05_Contract` | COMMERCIAL | contracts |
| ☐ | `01_Projects - Live/*/22_001_15_Variations` | COMMERCIAL | variations |
| ☐ | `01_Projects - Live/*/22_001_17_EOT's & NOD's` | COMMERCIAL | EOTs and notices of delay |
| ☐ | `01_Projects - Live/*/22_001_10_Client Correspondence` | COMMERCIAL | client letters (may mention money) |
| ☐ | `02_3 Tenders - Estimates & Quotes (2026)/*` | COMMERCIAL | 2026 tenders and quotes (D6-8: 2026 only; 2022–2025 add another ~400 GB, mostly drawings) |

**Templates, for you to confirm (DS-019):** `00_Templates` is drafted as MANAGER because it should hold blank forms only. If it also holds rate sheets, quote / estimate templates with our rates filled in, or anything with prices, it should be COMMERCIAL or left out. Please confirm before ticking it.

## Never read (the deny list wins, even inside a ticked folder)

| Folder / file | Why |
|---|---|
| `05_Employment & HR` | HR |
| `08_Finance`, `07_Progress Claims`, `06_Schedule of Rates` | finance, claims, confidential rates |
| `09_Legal` | legal |
| `10_Audit & Quality Systems` | holds personal folders (one per person) |
| `12. CLAUDE`, `13. Estimating workspace`, `.claude`, `zz_Redundant - Sep 2026 tidy` | working areas and old copies |
| inside each project: `22_001_02_Contact Lists`, `22_001_03_Cost Reports & Forecasts`, `22_001_11_Purchase Orders & Supplier Invoices`, `22_001_12_Subcontractors`, `22_001_14_Timesheets & Payroll`, `22_001_16_Progress Claims`, `…/06_Incident Report` | personal details, money, payroll (D6-7: incident reports name people) |
| any file whose name says payroll, timesheet, salary, super, tax file / TFN, bank details, password, passport, medical, warning letter, termination, resume / CV | personal or sensitive, wherever it sits |
| `03_General` except the four folders above (business plan, receivables, accounts, ASIC, finance, insurances, leases, sponsorships, suppliers, timesheets, vehicles, workers …) | accounts and company records |
| `04_Brand`, `Business plan (For operations)`, `Hand over (Operations ready)`, `Leza & Victoria - Cost tracking…`, `Management - Supplier invoices…`, `New folder`, `11_Policies & Insurances` | not job documents, or money (policies could be added later if you want them searchable) |
| loose files at the library root | not in any folder; never read |

## For you to look at (not part of this build)

- **Password sheet:** the library root holds a spreadsheet named **"Passwords sheet - Victoria .xlsx"**. It isn't, and can't be, read by document search: it's not in any approved folder, and "password" is on the deny list. But everyone with access to the Management site can open it. You may want it moved somewhere private, or into a password manager. I haven't opened it.
- **Two loose `.exe` files** at the library root (printer driver installers, by their names). They're harmless here, but unusual to keep in the document library.
