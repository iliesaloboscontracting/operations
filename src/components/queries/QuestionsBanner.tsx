"use client";

// "Questions for you (N)" (Task I, 25 Oct 2026) - at the top of the first
// screen after sign-in: the Directors overview for director logins, Invoices
// for accounts, the board for anyone else who's been asked. Links to where
// they answer. Shows a reminder date when Ilies has nudged. Nothing when
// there's nothing waiting.
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { whenText } from "@/lib/requestTypes";
import { useMyQueries } from "./MyQueries";

export default function QuestionsBanner({ onOpen, floating }: { onOpen?: () => void; floating?: boolean }) {
  const { accountsOnly, isDirector } = useAuth();
  const where = accountsOnly ? "/accounts/questions" : isDirector ? "/directors/queries" : "/questions";
  const { rows, waiting } = useMyQueries();
  if (!rows || waiting === 0) return null;
  // On the full-screen board: a small pill that doesn't move the board.
  if (floating) {
    return (
      <Link href={where} className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 shadow-lg backdrop-blur hover:bg-amber-500/30">
        <HelpCircle size={16} /> Questions for you ({waiting})
      </Link>
    );
  }
  const nudged = rows.filter((q) => (q.canAnswer || q.canMarkRead) && q.remindedAt).map((q) => q.remindedAt!).sort().pop();
  const label = `Questions for you (${waiting})`;
  const body = (
    <>
      <HelpCircle size={18} className="shrink-0" />
      <span className="font-semibold">{label}</span>
      <span className="text-amber-200/80">{waiting === 1 ? "Ilies is waiting on one answer" : "Ilies is waiting on your answers"}{nudged ? ` · reminded ${whenText(nudged)}` : ""}</span>
      <span className="ml-auto text-sm underline">Answer now</span>
    </>
  );
  const cls = "mb-4 flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-100 hover:bg-amber-500/15";
  // On the Invoices page the Queries tab is right there; elsewhere go to My queries.
  if (onOpen) return <button onClick={onOpen} className={cls}>{body}</button>;
  return <Link href={where} className={cls}>{body}</Link>;
}
