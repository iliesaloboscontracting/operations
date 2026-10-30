// The written daily site report's responses, shared by the office route (Manager+) and the directors' copy
// (guardDirector) - each route does its own guard first. Every report body passes the money guard (no dollar
// figure, ever); a photo is served only if that log holds it.
import { NextResponse } from "next/server";
import { assertNoMoney } from "../moneyGuard";
import { mediaTypeOf, readPhoto } from "../toolPhotos";
import { logPhotoFile, siteReport, siteReportDays } from "./store";
import { beforeAfterFile } from "./beforeAfterStore";

// opts.removed: only the office's route (Manager+) asks for removed before / after photos (SEC-BA-004).
export async function reportResponse(jobId: string, opts: { removed?: boolean } = {}) {
  const report = await siteReport(jobId, new Date(), opts);
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!assertNoMoney(JSON.stringify(report))) return NextResponse.json({ error: "This report can't be shown - tell the office." }, { status: 500 });
  return NextResponse.json({ report });
}

export async function daysResponse(projectId: string | null) {
  if (!projectId) return NextResponse.json({ error: "projectId is needed" }, { status: 400 });
  return NextResponse.json({ days: await siteReportDays(projectId) });
}

export async function photoResponse(log: string | null, file: string | null) {
  const name = await logPhotoFile(log ?? "", file ?? "");
  if (!name) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readPhoto(name).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(name), "Cache-Control": "private, max-age=86400" } });
}

// A before / after photo (30 Oct 2026): served only when it is a shown photo of that job.
export async function beforeAfterPhotoResponse(jobId: string | null, id: string | null, opts: { allowRemoved?: boolean } = {}) {
  const name = await beforeAfterFile(jobId ?? "", id ?? "", opts);
  if (!name) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readPhoto(name).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(name), "Cache-Control": "private, max-age=86400" } });
}
