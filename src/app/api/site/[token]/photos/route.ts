import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { DAILY_PHOTO_LIMIT, photosSentToday, resolveLink } from "@/lib/siteLinks";
import { PHOTO_KINDS, savePhoto } from "@/lib/toolPhotos";

// POST /api/site/:token/photos { kind, dataUrl } -> { id }
// Uploads one photo through a supervisor's link, up to a daily limit.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: { token: string } }) => {
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  if ((await photosSentToday(link.id)) >= DAILY_PHOTO_LIMIT) {
    return NextResponse.json({ error: "That's the most photos this link can send in a day - call the office." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  if (!(PHOTO_KINDS as readonly unknown[]).includes(body.kind)) {
    return NextResponse.json({ error: "Unknown photo type." }, { status: 400 });
  }
  const saved = await savePhoto(body.dataUrl);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
  const photo = await prisma.toolPhoto.create({
    data: { kind: body.kind, fileName: saved.fileName, takenBy: `${link.person.name}${link.shared && typeof body.who === "string" && body.who.trim() ? ` - ${body.who.trim().slice(0, 40)}` : ""} (site)`, siteLinkId: link.id },
  });
  return NextResponse.json({ id: photo.id }, { status: 201 });
});
