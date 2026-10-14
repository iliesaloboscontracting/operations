import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { renderScopePdf } from "@/lib/scopePdf";
import { assertNoMoney } from "@/lib/moneyGuard";

// GET /api/projects/:id/scope-pdf[?download=1]
// Every project gets a PDF, even one with no scopeOfWorks on file (it just
// says so) - the point is a reliable, always-clickable document per job, not
// one that's only there for the handful already researched.
export const GET = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      name: true,
      client: true,
      jobNo: true,
      address: true,
      status: true,
      dayStart: true,
      dayEnd: true,
      nightStart: true,
      nightEnd: true,
      scopeOfWorks: true,
      scopeExclusions: true,
    },
  });
  if (!project) {
    return NextResponse.json({ error: "That project doesn't exist anymore." }, { status: 404 });
  }

  // This document is designed to travel with the crew-facing allocation
  // email, so it must never carry a dollar figure - the same shared check
  // (lib/moneyGuard.ts) the day sheet runs, applied here to the two fields an
  // editor could put a price into before they reach the PDF.
  for (const [text, label] of [
    [project.scopeOfWorks, "scope of works"],
    [project.scopeExclusions, "exclusions"],
  ] as const) {
    if (text && !assertNoMoney(text)) {
      return NextResponse.json(
        { error: `This project's ${label} looks like it contains a dollar figure - remove it before the PDF can be generated.` },
        { status: 422 }
      );
    }
  }

  const buffer = await renderScopePdf(project);
  const safeName = project.name.replace(/[^\w\- ]+/g, "").trim() || "Scope of Works";
  const download = req.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName} - Scope of Works.pdf"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
});
