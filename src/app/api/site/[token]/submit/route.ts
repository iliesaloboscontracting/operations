import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink, type ResolvedLink } from "@/lib/siteLinks";
import { readToolPhotos, VisionNotConfigured } from "@/lib/toolVision";
import { runToolboxCheck } from "@/lib/toolboxCheckRun";
import { moveTool } from "@/lib/toolMoves";
import { createTool, duplicateMessage, findDuplicate } from "@/lib/toolCreate";

// POST /api/site/:token/submit
//   { kind: "READ", platePhotoId?, conditionPhotoId? }          -> details read from the photos (nothing saved)
//   { kind: "REGISTER", fields, plateUnreadable?, platePhotoId?, conditionPhotoId?, toolboxId?, note? }
//                                                                -> saved straight into the inventory
//   { kind: "FAULT", toolId, description, photoId? }             -> office inbox (supervisor links)
//   { kind: "CHECK", toolboxId, photoIds }                        -> checked now, result returned
//   { kind: "CHECK_ACTION", action: "MINE" | "MISSING", toolId, toolboxId }
// Supervisors run their own toolbox checks (Ilies, 19 Oct 2026): a check is
// recorded straight away, and from its result they can take a tool from
// another box into theirs or mark one of theirs missing - each logged as
// done by them through their link. Faults wait for the office.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: { token: string } }) => {
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const by = `${link.person.name} (site)`;
  try {
    switch (body.kind) {
      case "READ":
        return await read(link, body);
      case "REGISTER":
        return await register(link, body);
      case "FAULT":
        if (link.kind === "OFFICE") return bad("Faults are reported from a supervisor's link.");
        return await fault(link, body);
      case "CHECK":
        return await check(link, body, by);
      case "CHECK_ACTION":
        return await checkAction(link, body, by);
      default:
        return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof VisionNotConfigured) return NextResponse.json({ error: "Photo reading is down - try again later or call the office." }, { status: 503 });
    throw e;
  }
});

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Photos must have come through this same link, and be of the right kind.
async function linkPhotos(link: ResolvedLink, ids: unknown[], kind: string) {
  const wanted = ids.filter((x): x is string => typeof x === "string" && !!x);
  const photos = await prisma.toolPhoto.findMany({
    where: { id: { in: wanted }, siteLinkId: link.id, kind },
    select: { id: true, fileName: true },
  });
  return photos.length === wanted.length ? wanted.map((id) => photos.find((p) => p.id === id)!) : null;
}

const ownBox = (link: ResolvedLink, id: unknown) => link.toolboxes.find((b) => b.id === id) ?? null;

// Adding a tool from a phone link is two steps (19 Oct 2026):
//   READ     - the photos are read and the details come back to the phone to
//              check (nothing saved yet).
//   REGISTER - the checked details are saved straight into the inventory.
// A supervisor's tool goes into their toolbox marked "not checked yet" for
// the office; an office/yard person's tool goes where they choose, checked.
// Same rules as every other way in (lib/toolCreate.ts).
async function read(link: ResolvedLink, body: Record<string, unknown>) {
  const plate = body.platePhotoId ? await linkPhotos(link, [body.platePhotoId], "PLATE") : [];
  if (!plate) return bad("The rating plate photo didn't upload - take it again.");
  const cond = body.conditionPhotoId ? await linkPhotos(link, [body.conditionPhotoId], "CONDITION") : [];
  if (!cond) return bad("The tool photo didn't upload - take it again.");
  if (plate.length + cond.length === 0) return bad("Take a photo first, or type the details in yourself.");
  const reading = await readToolPhotos(plate[0]?.fileName ?? null, cond[0]?.fileName ?? null).catch((e) => {
    if (e instanceof VisionNotConfigured) throw e;
    return null;
  });
  if (!reading) return bad("The photos couldn't be read - type the details in yourself.");
  const duplicate = await findDuplicate(reading.serialNumber);
  return NextResponse.json({ ok: true, reading, duplicate: duplicate ? duplicateMessage(duplicate) : null });
}

// What a phone link may set on a new tool. Ownership/fleet only from the office link.
const SITE_TOOL_FIELDS = ["name", "brand", "model", "serialNumber", "itemNo", "manufactured", "condition", "conditionNotes", "notes"] as const;
const SITE_CONDITIONS = ["New", "Good", "Needs repair"];

async function register(link: ResolvedLink, body: Record<string, unknown>) {
  const raw = (body.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const k of SITE_TOOL_FIELDS) if (typeof raw[k] === "string") fields[k] = (raw[k] as string).trim().slice(0, k === "notes" || k === "conditionNotes" ? 500 : 120);
  if (fields.condition && !SITE_CONDITIONS.includes(fields.condition as string)) fields.condition = "Good";
  if (link.kind === "OFFICE") {
    if (typeof raw.ownership === "string") fields.ownership = raw.ownership;
    if (typeof raw.fleetRef === "string") fields.fleetRef = raw.fleetRef.trim().slice(0, 60);
  }
  fields.plateUnreadable = body.plateUnreadable === true;
  if (typeof body.note === "string" && body.note.trim()) {
    fields.notes = [fields.notes, `From site: ${body.note.trim().slice(0, 300)}`].filter(Boolean).join("\n");
  }

  const plate = body.platePhotoId ? await linkPhotos(link, [body.platePhotoId], "PLATE") : [];
  const cond = body.conditionPhotoId ? await linkPhotos(link, [body.conditionPhotoId], "CONDITION") : [];
  if (!plate || !cond) return bad("A photo didn't upload - take it again.");

  // Where it goes: a supervisor's own toolbox; for the office link, the
  // toolbox picked or the yard.
  let toolboxId: string | null;
  if (link.kind === "OFFICE") {
    toolboxId = body.toolboxId ? ownBox(link, body.toolboxId)?.id ?? null : null;
    if (body.toolboxId && !toolboxId) return bad("That toolbox doesn't exist anymore.");
  } else {
    toolboxId = (body.toolboxId ? ownBox(link, body.toolboxId) : link.toolboxes[0])?.id ?? null;
    if (!toolboxId) return bad("Pick your toolbox.");
  }

  const result = await createTool(fields, {
    photoIds: [...plate.map((p) => p.id), ...cond.map((p) => p.id)],
    siteLinkId: link.id,
    toolboxId,
    addedFrom: link.kind === "OFFICE" ? "OFFICE_LINK" : "SITE",
    addedBy: `${link.person.name} (${link.kind === "OFFICE" ? "office link" : "site"})`,
    needsCheck: link.kind !== "OFFICE",
  });
  if (!result.ok) return NextResponse.json({ error: result.error, duplicate: !!result.duplicate }, { status: result.status });

  // Kept as history on the office's From site page.
  await prisma.siteSubmission.create({
    data: {
      siteLinkId: link.id,
      kind: "REGISTER",
      photoIds: JSON.stringify([...plate.map((p) => p.id), ...cond.map((p) => p.id)]),
      toolboxId,
      status: "APPLIED",
      appliedRef: result.tool.id,
      reviewedBy: link.person.name,
      reviewedAt: new Date(),
    },
  });
  const box = link.toolboxes.find((b) => b.id === toolboxId)?.name ?? "the yard";
  return NextResponse.json(
    { ok: true, message: `Added to the inventory as ${result.tool.tag} (${result.tool.name}), in ${box}.` },
    { status: 201 }
  );
}

async function fault(link: ResolvedLink, body: Record<string, unknown>) {
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return bad("Write what's wrong with the tool.");
  const tool = typeof body.toolId === "string"
    ? await prisma.tool.findUnique({ where: { id: body.toolId }, select: { id: true, tag: true, toolboxId: true } })
    : null;
  if (!tool || !ownBox(link, tool.toolboxId)) return bad("Pick a tool from your toolbox.");
  const photo = body.photoId ? await linkPhotos(link, [body.photoId], "FAULT") : [];
  if (!photo) return bad("The fault photo didn't upload - take it again.");
  await prisma.siteSubmission.create({
    data: {
      siteLinkId: link.id,
      kind: "FAULT",
      photoIds: JSON.stringify(photo.map((p) => p.id)),
      toolId: tool.id,
      toolboxId: tool.toolboxId,
      description,
    },
  });
  return NextResponse.json({ ok: true, message: `Fault on ${tool.tag} sent to the office.` }, { status: 201 });
}

async function check(link: ResolvedLink, body: Record<string, unknown>, by: string) {
  const box = ownBox(link, body.toolboxId);
  if (!box) return bad("Pick your toolbox.");
  const ids = Array.isArray(body.photoIds) ? body.photoIds : [];
  if (ids.length === 0 || ids.length > 4) return bad("Take 1 to 4 photos of the toolbox laid out.");
  const photos = await linkPhotos(link, ids, "CHECK");
  if (!photos) return bad("A photo didn't upload - take it again.");
  const { check, result } = await runToolboxCheck(box.id, photos, by);
  await prisma.siteSubmission.create({
    data: {
      siteLinkId: link.id,
      kind: "CHECK",
      photoIds: JSON.stringify(photos.map((p) => p.id)),
      toolboxId: box.id,
      checkId: check.id,
      status: "APPLIED",
      reviewedBy: by,
      reviewedAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true, result }, { status: 201 });
}

async function checkAction(link: ResolvedLink, body: Record<string, unknown>, by: string) {
  const box = ownBox(link, body.toolboxId);
  if (!box) return bad("Pick your toolbox.");
  const tool = typeof body.toolId === "string"
    ? await prisma.tool.findUnique({ where: { id: body.toolId }, select: { id: true, tag: true, toolboxId: true, condition: true } })
    : null;
  if (!tool || tool.condition === "Swapped out") return bad("That tool isn't on the register.");
  if (body.action === "MINE") {
    if (tool.toolboxId === box.id) return NextResponse.json({ ok: true, message: `${tool.tag} is already in ${box.name}.` });
    await moveTool(tool.id, box.id, `Found in ${box.name} on a site photo check`, by);
    return NextResponse.json({ ok: true, message: `${tool.tag} now belongs in ${box.name}.` });
  }
  if (body.action === "MISSING") {
    if (tool.toolboxId !== box.id) return bad("You can only mark tools from your own toolbox missing.");
    await prisma.tool.update({ where: { id: tool.id }, data: { condition: "Missing" } });
    return NextResponse.json({ ok: true, message: `${tool.tag} marked missing - the office can see it.` });
  }
  return bad("Unknown action.");
}
