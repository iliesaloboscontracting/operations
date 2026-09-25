import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";

// GET /api/bugs -> every bug report, newest first (any signed-in user can view)
export async function GET() {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const bugs = await prisma.bugReport.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(bugs);
}

// POST /api/bugs -> file a bug report. Deliberately open to any signed-in user
// (including Viewers) - reporting a problem isn't "editing" app data.
export async function POST(req: NextRequest) {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));

  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!title || !description) {
    return NextResponse.json({ error: "Title and description are required" }, { status: 400 });
  }
  const severity = ["LOW", "MEDIUM", "HIGH"].includes(body.severity) ? body.severity : "MEDIUM";

  const bug = await prisma.bugReport.create({
    data: {
      title,
      description,
      page: typeof body.page === "string" ? body.page.slice(0, 200) : null,
      severity,
      reportedBy: user ? `${user.name} <${user.email}>` : null,
      userAgent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 300) : null,
    },
  });
  return NextResponse.json(bug, { status: 201 });
}
