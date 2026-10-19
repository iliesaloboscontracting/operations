import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink, type ResolvedLink } from "@/lib/siteLinks";
import { readToolPhotos, VisionNotConfigured } from "@/lib/toolVision";
import { runToolboxCheck } from "@/lib/toolboxCheckRun";
import { moveTool } from "@/lib/toolMoves";

// POST /api/site/:token/submit
//   { kind: "REGISTER", platePhotoId?, conditionPhotoId?, manual?, note? } -> office inbox
//      (a plate photo, or at least manual.toolType typed in)
//   { kind: "FAULT", toolId, description, photoId? }                 -> office inbox
//   { kind: "CHECK", toolboxId, photoIds }                            -> checked now, result returned
//   { kind: "CHECK_ACTION", action: "MINE" | "MISSING", toolId, toolboxId }
// Registering and faults wait for the office. Supervisors run their own
// toolbox checks (Ilies, 19 Oct 2026): a check is recorded straight away, and
// from its result they can take a tool from another box into theirs or mark
// one of theirs missing - each logged as done by them through their link.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: { token: string } }) => {
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const by = `${link.person.name} (site)`;
  try {
    switch (body.kind) {
      case "REGISTER":
        return await register(link, body);
      case "FAULT":
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

// Fields a supervisor can type in themselves on site (any can be blank).
const MANUAL_FIELDS = ["toolType", "brand", "model", "serialNumber"] as const;

async function register(link: ResolvedLink, body: Record<string, unknown>) {
  const raw = (body.manual ?? {}) as Record<string, unknown>;
  const manual: Partial<Record<(typeof MANUAL_FIELDS)[number], string>> = {};
  for (const k of MANUAL_FIELDS) {
    const v = typeof raw[k] === "string" ? (raw[k] as string).trim().slice(0, 120) : "";
    if (v) manual[k] = v;
  }
  const plate = body.platePhotoId ? await linkPhotos(link, [body.platePhotoId], "PLATE") : [];
  if (!plate) return bad("The rating plate photo didn't upload - take it again.");
  const cond = body.conditionPhotoId ? await linkPhotos(link, [body.conditionPhotoId], "CONDITION") : [];
  if (!cond) return bad("The condition photo didn't upload - take it again.");
  if (plate.length === 0 && !manual.toolType) return bad("Take the rating plate photo, or type in what the tool is.");

  // With a plate photo, read it now so the office opens it already filled
  // in. If reading fails the photos still go through. Anything typed in on
  // site wins over the reading, and isn't flagged "check this".
  const reading = plate.length
    ? await readToolPhotos(plate[0].fileName, cond[0]?.fileName ?? null).catch((e) => {
        if (e instanceof VisionNotConfigured) throw e;
        return null;
      })
    : null;
  const typed = Object.keys(manual);
  const combined = {
    toolType: "", brand: "", model: "", serialNumber: "", itemNo: "", manufactured: "", specs: "",
    conditionSuggestion: "Unclear", damage: "",
    ...(reading ?? {}),
    ...manual,
    uncertainFields: (reading?.uncertainFields ?? []).filter((f) => !typed.includes(f)),
    typedOnSite: typed,
  };
  await prisma.siteSubmission.create({
    data: {
      siteLinkId: link.id,
      kind: "REGISTER",
      photoIds: JSON.stringify([...plate.map((p) => p.id), ...cond.map((p) => p.id)]),
      toolboxId: link.toolboxes[0]?.id ?? null,
      description: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null,
      reading: reading || typed.length ? JSON.stringify(combined) : null,
    },
  });
  const what = [combined.brand, combined.model].filter(Boolean).join(" ") || combined.toolType;
  return NextResponse.json(
    { ok: true, message: `Sent to the office${what ? ` - ${what}` : ""}. They'll add it to the register.` },
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
