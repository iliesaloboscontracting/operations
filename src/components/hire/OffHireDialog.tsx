"use client";

import FormModal from "@/components/FormModal";
import { serverErrorMessage } from "@/lib/apiFetch";

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());

// "Off-hired" (Ilies, 5 Nov 2026): after ringing the supplier, the day it was called off and their
// off-hire number. The hire cost stops on that day, the item leaves the board after it and its
// off-hire request closes (api/resources/:id/off-hire).
export default function OffHireDialog({
  item,
  onClose,
  onDone,
}: {
  item: { id: string; name: string; supplier?: string | null };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  async function save(v: Record<string, any>) {
    const res = await fetch(`/api/resources/${item.id}/off-hire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: v.date, ref: v.ref || null }),
    });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save the off-hire."));
    const { closed, later } = await res.json();
    onDone(
      `${item.name} off-hired - its hire cost stops on that day${closed ? " and the off-hire request is closed" : ""}.` +
        (later ? ` It's still booked on the board on ${later} later day${later === 1 ? "" : "s"} - take it off there.` : ""),
    );
  }
  return (
    <FormModal
      title={`Off-hired: ${item.name}${item.supplier ? ` (${item.supplier})` : ""}`}
      fields={[
        { key: "date", label: "Called off on", type: "date", required: true },
        { key: "ref", label: "Off-hire number (from the supplier)", placeholder: "e.g. OH-12345" },
      ]}
      extra={
        <p className="text-xs text-gray-400">
          The hire cost stops on this day and the item comes off the board after it. If it&apos;s being picked up later, still use the day you called it off.
        </p>
      }
      initial={{ date: todayIso(), ref: "" }}
      onSave={save}
      onClose={onClose}
      submitLabel="Off-hired"
      savingLabel="Saving..."
    />
  );
}
