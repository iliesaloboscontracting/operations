import { NextRequest, NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readPhoto } from "@/lib/toolPhotos";
import { faultMedia } from "@/lib/prestart/store";
import { isMediaName, mediaResponse } from "@/lib/media/serve";

// GET /api/faults/media/:id -> the fault photo itself. Behind a login (guardFaults) - never on a link. Only a photo
// that went with a fault, or (stage 1b) a walk-around photo that went with its check (one uploaded for a check that
// was never sent isn't shown).
// Large uploads (10 Nov 2026): a photo or video in the bucket ("media:<id>") answers with a redirect to a 5-minute
// signed read of the checked version (?download=1 to save it) - after the same login and the same checks.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  const m = await faultMedia(params.id);
  if (!m || (!m.faultId && !m.checkId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (isMediaName(m.fileName)) return mediaResponse(m.fileName, req);
  const bytes = await readPhoto(m.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": m.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
});
