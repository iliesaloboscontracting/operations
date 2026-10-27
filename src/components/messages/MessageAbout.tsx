"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";

// "Message about this" on a record (docs/accounts/MESSAGING-DESIGN.md §6): opens a new message with the record
// attached. The record itself never changes because of a message.
export default function MessageAbout({ type, subjectKey, label }: { type: string; subjectKey: string; label: string }) {
  const href = `/messages?new=1&type=${encodeURIComponent(type)}&key=${encodeURIComponent(subjectKey)}&label=${encodeURIComponent(label)}`;
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline">
      <MessageSquare size={12} /> Message about this
    </Link>
  );
}
