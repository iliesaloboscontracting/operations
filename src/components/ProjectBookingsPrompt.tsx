"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { bookingCancellable, HAS_BOOKINGS, type Booking, type BookingsDecision } from "@/lib/projectLists";

// Marking a project Completed while it still has bookings ahead (Ilies, 18 Nov 2026: "do you mean stand down or
// inactive for now?"). Every screen that can set a project to Completed saves through patchProject() here: the server
// answers 409 "has-bookings" with the list, this asks, and the save is sent again with the choice. "Cancel" saves
// nothing (the form stays open with a note). Render `modal` somewhere on the page.
type Choice = BookingsDecision | "CANCEL";

const day = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short" });
const shiftWord = (s: string) => (s === "NIGHT" ? "night" : "day");

export function useProjectPatch() {
  const [asking, setAsking] = useState<{ error: string; bookings: Booking[]; resolve: (c: Choice) => void } | null>(null);

  async function patchProject(id: string, body: Record<string, unknown>): Promise<Response> {
    const send = (extra: Record<string, unknown> = {}) =>
      apiFetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...extra }) });
    const res = await send();
    if (res.status !== 409) return res;
    const j = (await res.clone().json().catch(() => null)) as { code?: string; error?: string; bookings?: Booking[] } | null;
    if (j?.code !== HAS_BOOKINGS || !j.bookings?.length) return res;
    const choice = await new Promise<Choice>((resolve) => setAsking({ error: j.error ?? "", bookings: j.bookings!, resolve }));
    setAsking(null);
    if (choice === "CANCEL") throw new Error("Not saved - the project is as it was.");
    return send({ bookings: choice });
  }

  const modal = asking ? <BookingsQuestion bookings={asking.bookings} onChoose={asking.resolve} /> : null;
  return { patchProject, modal };
}

// After a "complete and cancel" save: a line for the page to show, e.g. "Completed - 3 booked days cancelled; kept
// (people signed in): Tue 19 Nov day."
export function bookingsOutcomeText(saved: { bookings?: { cancelled: Booking[]; kept: (Booking & { why: string })[] } } | null): string | null {
  const o = saved?.bookings;
  if (!o) return null;
  const parts = [`${o.cancelled.length} booked day${o.cancelled.length === 1 ? "" : "s"} cancelled`];
  if (o.kept.length) parts.push(`left as they are: ${o.kept.map((b) => `${day(b.date)} ${shiftWord(b.shift)} (${b.why})`).join(", ")}`);
  return `Completed - ${parts.join("; ")}.`;
}

function BookingsQuestion({ bookings, onChoose }: { bookings: Booking[]; onChoose: (c: Choice) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  const choose = useRef(onChoose);
  choose.current = onChoose;
  useEffect(() => {
    first.current?.focus();
    // Escape here is Cancel - and must not also close the form underneath (FormModal listens on window).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      choose.current("CANCEL");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const can = bookings.filter(bookingCancellable);
  const kept = bookings.filter((b) => !bookingCancellable(b));
  const from = bookings[0].date;
  const btn = (c: Choice, label: string, tone: string, ref?: Ref<HTMLButtonElement>) => (
    <button key={c} ref={ref} type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChoose(c); }}
      className={`rounded-lg px-3.5 py-2 text-left text-sm font-medium ${tone}`}>
      {label}
    </button>
  );
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 normal-case tracking-normal"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="project-bookings-q"
        className="w-full max-w-md rounded-2xl border border-edge bg-panel p-5 text-sm shadow-soft-lg">
        <p id="project-bookings-q" className="text-base font-semibold text-gray-100">
          This project still has {bookings.length} booked day{bookings.length === 1 ? "" : "s"} from {day(from)}. Do you mean stand down for now?
        </p>
        <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-gray-400">
          {bookings.map((b) => (
            <li key={b.id}>
              {day(b.date)} · {shiftWord(b.shift)}
              {!bookingCancellable(b) && <span className="text-amber-500"> · {b.signIns ? "people signed in" : "daily log recorded"} - stays booked</span>}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-2">
          {btn("STAND_DOWN", "Stand down for now (keeps the bookings)", "bg-brand-600 text-white hover:bg-brand-500", first)}
          {btn("CANCEL_BOOKINGS",
            can.length
              ? `Complete it and cancel the ${can.length} booked day${can.length === 1 ? "" : "s"} from ${day(can[0].date)}${kept.length ? ` (${kept.length} with sign-ins stay)` : ""}`
              : `Complete it anyway (the ${kept.length} booked day${kept.length === 1 ? "" : "s"} with sign-ins stay)`,
            "border border-edge text-gray-200 hover:bg-panel2")}
          {btn("CANCEL", "Cancel", "text-gray-400 hover:bg-panel2 hover:text-gray-200")}
        </div>
        <p className="mt-3 text-[11px] text-gray-500">Cancelled days are kept on record with the reason "project completed" - nothing is deleted.</p>
      </div>
    </div>,
    document.body,
  );
}
