import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeProject, officeProjects, officeSummary, recordList } from "@/lib/siteDocs/office";

// GET /api/site-documents -> the projects (with how many plans / SWMS versions / records each) and the latest
// pre-starts and toolbox talks; ?projectId= -> one project: plans, SWMS versions (current / superseded / archived, how
// many signed), "on site today and not signed the current SWMS", its records. Managers, Admins (the owner) and the
// coordinator only (guardSiteDocs). Never incidents (owner / directors only). No prices anywhere.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  // ?summary=1 -> the coordinator's dashboard card: projects with a job today, how many have no SWMS, how many people on
  // site today haven't signed the current one (counts only).
  if (req.nextUrl.searchParams.get("summary") === "1") return NextResponse.json(await officeSummary());
  const projectId = req.nextUrl.searchParams.get("projectId")?.slice(0, 40);
  if (projectId) {
    const p = await officeProject(projectId);
    return p ? NextResponse.json(p) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const kind = req.nextUrl.searchParams.get("kind")?.slice(0, 20) ?? undefined;
  const [projects, records] = await Promise.all([officeProjects(), recordList({ kind })]);
  return NextResponse.json({ projects, records: records.slice(0, 100) });
});