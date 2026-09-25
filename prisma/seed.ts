import { PrismaClient } from "@prisma/client";
import { seedSchedule } from "./seed-schedule";

const prisma = new PrismaClient();

function day(offset = 0) {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate() + offset));
}

async function main() {
  console.log("Seeding...");
  await prisma.assignment.deleteMany();
  await prisma.job.deleteMany();
  await prisma.project.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.tool.deleteMany();

  // ---------- Labour ----------
  type P = [string, string, string, string, string?]; // name, category, role, payClass, phone
  const people: P[] = [
    ["Leza", "Office", "Operator", "Operations Manager"],
    ["Damien", "Site Manager", "Supervisor", "Site Manager", "+61415132942"],
    ["Ezra", "Site Manager", "Lead", "Site Manager"],
    ["Pol", "Site Manager", "Supervisor", "Site Manager", "+61406805024"],
    ["Sinan", "Site Manager", "Supervisor", "Site Manager", "+61410452860"],
    ["Villi", "Site Manager", "Supervisor", "Site Manager", "+61475675042"],
    ["Chris", "Site Manager", "Supervisor", "Site Manager"],
    ["Tom", "Site Manager", "Supervisor", "Site Manager"],
    ["Omar E", "Site Manager", "Supervisor", "Site Manager"],
    ["Roslyn", "Site Manager", "Lead", "Site Manager"],
    ["Joao", "Site Manager", "Supervisor", "Site Manager"],
    ["Arvin", "Truck Driver", "Driver", "Truck Driver", "+61423824435"],
    ["Carlos", "Truck Driver", "Driver", "Truck Driver", "+61478076707"],
    ["Felipe Fuentes", "Truck Driver", "Driver", "Truck Driver"],
    ["Jose", "Truck Driver", "Driver", "Truck Driver", "+61405693275"],
    ["Turori", "Truck Driver", "Driver", "Truck Driver", "+61449732715"],
    ["Anthony", "Truck Driver", "Driver", "Truck Driver"],
    ["Mikdat", "Labourer", "Operator", "Labourer"],
    ["Josepth", "Labourer", "Operator", "Labourer"],
    ["Aaron (Ezras mate)", "Labourer", "General labour", "Labourer"],
    ["Abdul", "Labourer", "General labour", "Labourer"],
    ["Abdulkadir", "Labourer", "General labour", "Labourer"],
    ["Alperen", "Labourer", "General labour", "Labourer"],
    ["Anasa", "Labourer", "General labour", "Labourer"],
    ["Ratu", "Labourer", "General labour", "Labourer"],
    ["Cem", "Labourer", "General labour", "Labourer"],
    ["Yiota", "Labourer", "General labour", "Labourer"],
    ["Evan", "Labourer", "General labour", "Labourer"],
    ["Theo", "Labourer", "General labour", "Labourer"],
    ["Justinian", "Labourer", "General labour", "Labourer"],
    ["Sam Marakiwai", "Labourer", "General labour", "Labourer"],
    ["Jonetani", "Labourer", "General labour", "Labourer"],
    ["Muhummet", "Labourer", "General labour", "Labourer"],
    ["David", "Labourer", "General labour", "Labourer"],
    ["Rooster", "Labourer", "Lead", "Labourer"],
    ["Daniel", "Labourer", "General labour", "Labourer"],
    ["Emil", "Labourer", "General labour", "Labourer"],
    ["Joe", "Labourer", "General labour", "Labourer"],
    ["Nathan", "Labourer", "General labour", "Labourer"],
  ];
  const R: Record<string, { id: string }> = {};
  for (const [name, category, role, payClass, phone] of people) {
    R[name] = await prisma.resource.create({
      data: { name, type: "PERSONNEL", category, role, payClass, phone: phone ?? null },
    });
  }

  // ---------- Plant & attachments ----------
  for (const n of [
    "1.7t Excavator", "15t Excavator", "1t Excavator", "20t Excavator", "3.5t Excavator",
    "5.5t Excavator", "8t Excavator", "Electric walkie jib extendable crane",
    "Forklift 2.5t #1", "Forklift 2.5t #2", "Scissor lift",
  ]) {
    R[n] = await prisma.resource.create({
      data: { name: n, type: "EQUIPMENT", category: "Plant", role: "Plant" },
    });
  }
  for (const [n, suits] of [
    ["GP bucket 1.7t", "1.7t Excavator"], ["GP bucket 15t", "15t Excavator"],
    ["GP bucket 20t", "20t Excavator"], ["GP bucket 3.7t", "3.5t Excavator"],
    ["GP bucket 5.5t", "5.5t Excavator"], ["GP bucket 8t", "8t Excavator"],
    ["Mud bucket 1.7t", "1.7t Excavator"], ["Mud bucket 3.7t", "3.5t Excavator"],
    ["Hammer (1.7t)", "1.7t Excavator"], ["Rock saw", "5.5t Excavator"],
  ]) {
    R[n] = await prisma.resource.create({
      data: { name: n, type: "ATTACHMENT", category: "Attachment", role: "Attachment", detail: `suits ${suits}` },
    });
  }

  // ---------- Vehicles ----------
  const vehicles: [string, string, string, string?, string?][] = [
    ["Hook Truck - XO20TL", "Hook", "XO20TL", "10t", "2019 ISUZU FSR850. Rego exp 15/11/26."],
    ["7 Seater", "Tipper", "XO76CN", undefined, undefined],
    ["Tipper - DD50LV", "Tipper", "DD50LV", "4t", "ISUZU NPR45 (4HK1). Rego exp 17/5/27."],
    ["Tipper - DO17HS", "Tipper", "DO17HS", undefined, undefined],
    ["Tipper - XO78CN", "Tipper", "XO78CN", "6t", "ISUZU NPR65. Rego exp 20/10/26. Financed."],
    ["Delta Daihatsu - DA82HN", "Ute", "DA82HN", undefined, "DAIHATSU Delta truck. Rego exp 8/4/27."],
    ["LDV Van - FHF58Q", "Ute", "FHF58Q", "1t", "2024 LDV V80. Rego exp 30/5/27."],
    ["Trailer - TK61KX", "Other", "TK61KX", undefined, "Trailer (Grays Online). Rego exp 7/4/2027."],
    ["Trailer - TP90JW", "Other", "TP90JW", undefined, undefined],
    ["Trailer - TT08PK", "Other", "TT08PK", undefined, "2013 trailer. Rego exp 28/11/2026."],
  ];
  for (const [name, category, identifier, loadSize, notes] of vehicles) {
    R[name] = await prisma.resource.create({
      data: { name, type: "VEHICLE", category, role: "Vehicle", identifier, loadSize: loadSize ?? null, notes: notes ?? null },
    });
  }

  // ---------- Hire ----------
  await prisma.resource.createMany({
    data: [
      { name: "Matrix cutting Services forster", type: "HIRE", category: "LABOUR", role: "General labour", ownership: "HIRED", hireStart: "12 Aug" },
      { name: "Labourer (Swiss Hotel #1)", type: "HIRE", category: "LABOUR", role: "General labour", ownership: "HIRED", hireStart: "7 Sept" },
      { name: "Labourer (Swiss Hotel #2)", type: "HIRE", category: "LABOUR", role: "General labour", ownership: "HIRED", hireStart: "9 Sept" },
      { name: "Concrete Pump (hire)", type: "HIRE", category: "PLANT", role: "Pump", ownership: "HIRED" },
      { name: "Generator 20kVA (hire)", type: "HIRE", category: "PLANT", role: "Generator", ownership: "HIRED" },
    ],
  });

  // ---------- Projects ----------
  const proj = async (
    name: string, jobNo: string | null, status: string,
    dayStart: string | null, dayEnd: string | null, nightStart?: string, nightEnd?: string
  ) =>
    prisma.project.create({
      data: { name, jobNo, status, dayStart, dayEnd, nightStart: nightStart ?? null, nightEnd: nightEnd ?? null },
    });
  const pBronte = await proj("CD Bronte", null, "ACTIVE", "7am", "3:30pm");
  const pColes = await proj("Coles Campbell Town - Pri...", "016", "ACTIVE", null, null, "10pm", "6am");
  const pMyers = await proj("Myers - Streetbuild", "007", "ACTIVE", "8:30am", "3pm", "2:30pm", "11pm");
  const pWinston = await proj("Winston Hills Shopping centre - CD", null, "ACTIVE", "7am", "5pm");
  const pMtHutton = await proj("WW Mt Hutton", "26_312", "ACTIVE", null, null, "10pm", "6am");
  const pForster = await proj("Forster", "009", "ACTIVE", null, null, "9pm", "6am");
  const pDblBay = await proj("Double Bay - Five X", "002", "ACTIVE", "7am", "3:30pm");
  const pVaucluse = await proj("Vaucluse", "012", "ACTIVE", "7am", "3:30pm");
  const pYard = await proj("Yard - 7 Argyle St, Wolli Creek", null, "ACTIVE", "6:30am", "3pm");
  await proj("Mosman - Decode", "006", "ACTIVE", "7am", "3:30pm");
  await proj("Woollahra - CD", "001", "ACTIVE", "7am", "3:30pm");
  await proj("14 Park Avenue, Randwick", null, "STAND_DOWN", "7am", "3:30pm");
  await proj("Swiss Hotel", null, "STAND_DOWN", "7am", "3:30pm");
  await proj("bupa Hurstville shopping centre", null, "STAND_DOWN", "7am", "3:30pm");
  await proj("Gym demolition - Potts Point", "26_419", "STAND_DOWN", "7am", "5pm");
  await proj("Airgate - Mainbrace", null, "ON_HOLD", "7am", "5pm");

  // ---------- Today's board ----------
  const date = day(0);
  const job = (p: { id: string }, title: string, siteCode: string | null, shift: string,
    startTime: string | null, endTime: string | null, dayBrief: string, colorTag: string,
    sortOrder: number, notRunning = false) =>
    prisma.job.create({
      data: { projectId: p.id, title, siteCode, date, shift, startTime, endTime, dayBrief, colorTag, sortOrder, notRunning },
    });

  const jBronte = await job(pBronte, "CD Bronte", null, "DAY", "7am", "3:30pm", "As per the builders instructions", "orange", 1);
  const jColes = await job(pColes, "Coles Campbell Town - Pri...", "016", "NIGHT", "10pm", "6am", "As per Pols instructions", "purple", 2);
  const jMyD = await job(pMyers, "Myers - Streetbuild", "007", "DAY", "6:30am", "3pm", "As per Chris's instructions", "orange", 3);
  const jMyN = await job(pMyers, "Myers - Streetbuild", "007", "NIGHT", "2:30pm", "11pm", "As per damiens instructions", "purple", 4);
  const jWin = await job(pWinston, "Winston Hills Shopping centre - CD", null, "DAY", "7am", "5pm", "As instructed by Sinan", "blue", 5);
  const jHut = await job(pMtHutton, "WW Mt Hutton", "26_312", "NIGHT", "10pm", "6am", "As per Joao Instructions", "blue", 6);
  const jFor = await job(pForster, "Forster", "009", "NIGHT", "9pm", "6am", "As per Villis instruction", "purple", 7);
  const jDbl = await job(pDblBay, "Double Bay - Five X", "002", "DAY", "7am", "3:30pm", "Positioning of steel beams into place", "orange", 8);
  const jVau = await job(pVaucluse, "Vaucluse", "012", "DAY", "7am", "3:30pm", "As per sinans instructions", "orange", 9);
  await job(pYard, "Yard - 7 Argyle St, Wolli Creek", null, "DAY", null, null, "", "gray", 90, true);

  const put = (j: { id: string }, entries: [string, string][]) =>
    prisma.assignment.createMany({
      data: entries.map(([n, role]) => ({ jobId: j.id, resourceId: R[n].id, role })),
    });

  await put(jBronte, [["Justinian", "General labour"]]);
  await put(jColes, [["Pol", "Supervisor"], ["Anasa", "General labour"], ["Ratu", "General labour"]]);
  await put(jMyD, [
    ["Chris", "Supervisor"], ["Tom", "Supervisor"], ["Mikdat", "Operator"], ["Anthony", "Driver"],
    ["Arvin", "Driver"], ["Carlos", "Driver"], ["Cem", "General labour"], ["Yiota", "General labour"],
  ]);
  await put(jMyN, [["Damien", "Supervisor"], ["Ezra", "Lead"], ["Evan", "General labour"], ["Theo", "General labour"], ["Turori", "Driver"]]);
  await put(jWin, [
    ["Omar E", "Supervisor"], ["Sinan", "Supervisor"], ["Roslyn", "Lead"], ["Josepth", "Operator"],
    ["Abdul", "General labour"], ["Abdulkadir", "General labour"], ["Alperen", "General labour"],
    ["5.5t Excavator", "Plant"],
  ]);
  await put(jHut, [["Joao", "Supervisor"], ["Sam Marakiwai", "General labour"]]);
  await put(jFor, [["Villi", "Supervisor"], ["Jonetani", "General labour"]]);
  await put(jDbl, [["Felipe Fuentes", "Driver"], ["Muhummet", "General labour"]]);
  await put(jVau, [["Rooster", "Lead"], ["David", "General labour"], ["1.7t Excavator", "Plant"], ["Rock saw", "Attachment"], ["Hammer (1.7t)", "Attachment"]]);

  // ---------- Tools ----------
  const tools: [string, string, string, string, string][] = [
    ["LOB-0001", "Hilti Battery pack", "B 22-290 Li-ion · 512933734", "New", "Yard"],
    ["LOB-0002", "Hilti Jackhammer", "TE 2000-AVR", "Good", "Yard"],
    ["LOB-0003", "Hilti Jackhammer", "TE 2000-AVR", "Good", "Yard"],
    ["LOB-0004", "Hilti Jackhammer", "TE 2000-AVR · 091431", "Good", "Yard"],
    ["LOB-0006", "Hilti Jackhammer", "TE 3000-AVR", "Good", "Yard"],
    ["LOB-0007", "Hilti Air scrubber", "AIC 2000 (01) · 2311020066", "Good", "Yard"],
    ["LOB-0009", "Hilti Vacuum", "VC 40MX 05 · 1404011781", "Good", "Yard"],
    ["LOB-0010", "Hilti Demo saw", "DSH 900-22 · 013013", "Good", "Yard"],
    ["LOB-0012", "Eibenstock Flush saw", "ETR 400.1 P · 2023 0090", "Good", "Yard"],
    ["LOB-0014", "Hilti Jackhammer 700", "TE 700-AVR", "Good", "Yard"],
    ["LOB-0018", "Hilti Jackhammer 600", "TE 600-AVR · 017290", "Good", "Yard"],
    ["LOB-0021", "Hilti Jackhammer 1000", "TE 1000-AVR 02 · 247705", "Good", "Yard"],
    ["LOB-0023", "Hilti Jackhammer 1000", "TE 1000-AVR", "Needs repair", "Yard"],
    ["LOB-0024", "Hilti Demo saw", "—", "Needs repair", "Yard"],
  ];
  for (const [tag, name, model, condition, heldBy] of tools) {
    await prisma.tool.create({ data: { tag, name, model, condition, heldBy, lastSeen: "2026-09-10" } });
  }

  await seedSchedule(prisma);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
