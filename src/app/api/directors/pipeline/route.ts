import { NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadPipelineState } from "@/lib/insights/pipelineFeed";
import { openWork, pipelineConfidence } from "@/lib/insights/pipeline";

// GET /api/directors/pipeline -> Estimating's tender pipeline (pipeline.v1)
// and its won tenders matched to Operations projects (won-tenders.v1), for
// Directors -> Pipeline (G5, 25 Oct 2026). Director access only; read-only.
// When Estimating doesn't answer: { reachable: false } and no figures.
export const GET = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  const s = await loadPipelineState();
  if (!s.ok) return NextResponse.json({ reachable: false, reason: s.reason });
  return NextResponse.json({
    reachable: true,
    pipeline: s.pipeline,
    open: openWork(s.pipeline),
    confidence: pipelineConfidence(s.pipeline),
    won: s.won,
  });
});
