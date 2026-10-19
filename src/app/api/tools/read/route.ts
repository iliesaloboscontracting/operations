import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readToolPhotos, VisionNotConfigured } from "@/lib/toolVision";
import { normSerial } from "@/lib/toolboxCheck";

// POST /api/tools/read { platePhotoId, conditionPhotoId }
// -> { reading, suggestedTag, duplicate }
// Reads the two registration photos and returns a SUGGESTION for the form.
// Nothing is saved here - the person checks it and saves the tool themselves.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const ids = [body.platePhotoId, body.conditionPhotoId].filter((x): x is string => typeof x === "string" && !!x);
  if (ids.length === 0) return NextResponse.json({ error: "Add at least the rating plate photo." }, { status: 400 });
  const photos = await prisma.toolPhoto.findMany({ where: { id: { in: ids } }, select: { id: true, fileName: true } });
  const file = (id: unknown) => photos.find((p) => p.id === id)?.fileName ?? null;

  try {
    const reading = await readToolPhotos(file(body.platePhotoId), file(body.conditionPhotoId));
    // Same serial already on the register? Say so before a second copy is made.
    const serial = normSerial(reading.serialNumber);
    const duplicate = serial
      ? (await prisma.tool.findMany({ where: { serialNumber: { not: null } }, select: { tag: true, name: true, serialNumber: true } })).find(
          (t) => normSerial(t.serialNumber) === serial
        ) ?? null
      : null;
    return NextResponse.json({ reading, suggestedTag: await nextToolTag(), duplicate });
  } catch (e) {
    if (e instanceof VisionNotConfigured) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
});

// Next free LOB-#### after the highest existing tag.
async function nextToolTag() {
  const tags = await prisma.tool.findMany({ select: { tag: true } });
  const max = tags.reduce((n, t) => Math.max(n, Number(t.tag.match(/LOB-(\d+)/)?.[1] ?? 0)), 0);
  return `LOB-${String(max + 1).padStart(4, "0")}`;
}
