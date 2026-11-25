import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { buildCard, cardIsMoneyFree, cardVariant } from "@/lib/findings/card";
import { lciCardOn, rulesOff } from "@/lib/findings/config";

// GET /api/findings/card -> the "Needs attention" card (LCI Stage 1, Ilies 25 Nov 2026: "approve all defaults").
// The owner, Admins and Managers: the Operations card on the board (/command). The coordinator: his money-free
// "For you" card (/coordinator). Every other login: 403 - nothing shows. Read-only; Done / Snooze go through
// /api/findings/:id. LCI_CARD=off -> { off: true } and the card hides. Rules in lib/findings/card.ts.
export const GET = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const variant = cardVariant(user);
  if (!variant) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  if (!lciCardOn()) return NextResponse.json({ off: true });
  const rows = await prisma.finding.findMany({
    where: {
      OR: [
        { status: { in: ["OPEN", "ACKNOWLEDGED", "ACTIONED"] } },
        { status: "RESOLVED", resolvedWhileFiring: true, signalClearedAt: null }, // marked Done, still firing
      ],
    },
    select: { id: true, ruleCode: true, severity: true, audience: true, status: true, title: true, href: true, firstSeenAt: true, signalClearedAt: true, resolvedWhileFiring: true, currentValue: true },
  });
  const card = buildCard(rows, variant, rulesOff());
  // The coordinator's card never carries a dollar figure (each line is checked too - lib/findings/card.ts onCard).
  if (variant === "COORDINATOR" && !cardIsMoneyFree(card)) return NextResponse.json({ ...card, top: [], more: [], counts: { urgent: 0, toDo: 0, dataGaps: 0 } });
  return NextResponse.json(card);
});
