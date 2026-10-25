import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink, resolveReceiptLink } from "@/lib/siteLinks";
import { receiptsSentToday } from "@/lib/receipts/store";
import { OPEN_STATUSES } from "@/lib/requestTypes";
import { hireForLink } from "@/lib/hireCheck";
import { LINK_WHERE } from "@/lib/siteRequests";
import { isPilotLink, logCard } from "@/lib/dailyLog/store";

// GET /api/site/:token -> who the link belongs to and their toolbox(es) with
// the tools in each (for picking a tool when reporting a fault). Tool names
// and serials only - nothing else from Operations is reachable from here.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link) {
    // A DRIVER link (Receipts, 26 Oct 2026): receipts only - nothing else is reachable from it.
    const driver = await resolveReceiptLink(params.token);
    if (driver?.kind === "DRIVER") return NextResponse.json({ person: driver.person.name, kind: "DRIVER", shared: false, toolboxes: [], openRequests: 0, needsAnswer: 0, todo: 0, hireItems: 0, hireToCheck: 0, receiptsToday: await receiptsSentToday(driver.person.id) });
    return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  }
  const toolboxes = await prisma.toolbox.findMany({
    where: { id: { in: link.toolboxes.map((b) => b.id) } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tools: {
        where: { condition: { not: "Swapped out" } },
        orderBy: { tag: "asc" },
        select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, condition: true },
      },
    },
  });
  // Counts for the request buttons: a supervisor's open requests (and how
  // many the office has a question on), an office person's to-do list.
  // ...and how many hire items are waiting for the hire check.
  const [openRequests, needsAnswer, todo, hire] = await Promise.all([
    link.kind === "OFFICE" ? 0 : prisma.siteRequest.count({ where: { siteLinkId: link.id, ...LINK_WHERE, status: { in: OPEN_STATUSES } } }),
    link.kind === "OFFICE" ? 0 : prisma.siteRequest.count({ where: { siteLinkId: link.id, ...LINK_WHERE, status: "NEEDS_INFO" } }),
    link.kind === "OFFICE" && link.person.id ? prisma.siteRequest.count({ where: { assigneeId: link.person.id, ...LINK_WHERE, kind: { not: "QUERY" }, status: "TODO" } }) : 0,
    link.kind === "OFFICE" ? [] : hireForLink(link),
  ]);
  // The Daily log card (Task K) - only on pilot links (DAILY_LOG_PILOT_LINKS); others get exactly what they got before.
  const dailyLog = (await isPilotLink(link)) ? await logCard(link, new Date()) : undefined;
  // Receipts sent today - supervisors send tip dockets and fuel receipts too.
  const receipts = link.kind === "SUPERVISOR" && link.person.id ? { receiptsToday: await receiptsSentToday(link.person.id) } : {};
  return NextResponse.json({ person: link.person.name, kind: link.kind, shared: link.shared, toolboxes, openRequests, needsAnswer, todo, hireItems: hire.length, hireToCheck: hire.filter((h) => h.askNow).length, ...(dailyLog ? { dailyLog } : {}), ...receipts });
});
