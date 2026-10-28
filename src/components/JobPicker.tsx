"use client";

import { useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { jobLabel, searchJobs, type JobOption } from "@/lib/jobSearch";

// A searchable job choice (accounts, 28 Oct 2026) in place of a long dropdown: type part of the job name, number,
// client or address, then click / tap a job or use up / down and Enter. Built from page elements, not a <select>, so
// the list is readable on every screen. Only picks the id - saving is up to the screen using it.
export default function JobPicker({ jobs, value, onChange, placeholder = "Search jobs - name, number, client or address", label, className = "" }: {
  jobs: JobOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLInputElement>(null);
  const chosen = jobs.find((j) => j.id === value);
  const hits = useMemo(() => searchJobs(jobs, query), [jobs, query]);

  function pick(j: JobOption) {
    onChange(j.id);
    setQuery("");
    setOpen(false);
  }
  function key(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (open && hits[active]) { e.preventDefault(); pick(hits[active]); } }
    else if (e.key === "Escape") setOpen(false);
  }

  if (chosen) {
    return (
      <div className={`flex min-h-[38px] items-center gap-2 rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-sm text-gray-200 ${className}`}>
        <span className="min-w-0 flex-1 truncate" title={[chosen.client, chosen.address].filter(Boolean).join(" · ")}>{jobLabel(chosen)}</span>
        <button type="button" onClick={() => { onChange(""); setTimeout(() => box.current?.focus(), 0); }} aria-label={label ? `Change ${label}` : "Change the job"}
          className="rounded p-0.5 text-gray-500 hover:bg-panel hover:text-gray-200"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <div className={`relative ${className}`}>
      <input ref={box} value={query} placeholder={placeholder} aria-label={label ?? "Job"} role="combobox" aria-expanded={open} aria-controls={listId}
        aria-autocomplete="list" aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={key}
        className="w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-lg border border-edge bg-panel py-1 shadow-lg">
          {hits.map((j, n) => (
            <li key={j.id} id={`${listId}-${n}`} role="option" aria-selected={n === active}
              onMouseDown={(e) => { e.preventDefault(); pick(j); }} onMouseEnter={() => setActive(n)}
              className={`cursor-pointer px-3 py-2 text-sm ${n === active ? "bg-panel2 text-gray-100" : "text-gray-300"}`}>
              <div className="truncate">{jobLabel(j)}</div>
              {(j.client || j.address) && <div className="truncate text-[11px] text-gray-500">{[j.client, j.address].filter(Boolean).join(" · ")}</div>}
            </li>
          ))}
          {!hits.length && <li className="px-3 py-2 text-sm text-gray-500">No job matches &quot;{query.trim()}&quot;.</li>}
        </ul>
      )}
    </div>
  );
}
